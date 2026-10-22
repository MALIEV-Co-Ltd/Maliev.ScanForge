import { afterEach, expect, it, vi } from "vitest";
import { editPointCloud } from "../src/point-cloud-processing";
import { processMesh, type ProcessingRequest } from "../src/processing-client";

afterEach(() => vi.unstubAllGlobals());

const positions = new Float32Array([0, 0, 0, 0.1, 0, 0, 1, 0, 0, 1.1, 0, 0]);
const pointColors = Uint8Array.from([
  0, 1, 2, 255, 3, 4, 5, 255, 6, 7, 8, 255, 9, 10, 11, 255,
]);
const common = { kind: "pointCloudEdit" as const, positions, pointColors };

it("validates opaque RGBA views against their exact point slots", async () => {
  const { validatePointColors } = await import("../src/point-cloud-colors");
  const backing = new Uint8Array(pointColors.length + 8);
  backing.set(pointColors, 4);
  expect(() => validatePointColors(backing.subarray(4, 20), 4)).not.toThrow();
  expect(() => validatePointColors(undefined, 4)).not.toThrow();
  expect(() => validatePointColors(new Uint8Array(), 0)).not.toThrow();
  expect(() => validatePointColors(pointColors, 3)).toThrow(/color/i);
  expect(() =>
    validatePointColors([0, 0, 0, 255] as unknown as Uint8Array, 1),
  ).toThrow(/color/i);
  const transparent = pointColors.slice();
  transparent[7] = 254;
  expect(() => validatePointColors(transparent, 4)).toThrow(/opaque|alpha/i);
  expect(() => validatePointColors(undefined, 0.5)).toThrow(/point/i);
});

it("reindexes byte-exact colors including repeated slots without changing source backing", async () => {
  const { reindexPointColors } = await import("../src/point-cloud-colors");
  const before = pointColors.slice();
  const result = reindexPointColors(
    pointColors,
    Uint32Array.from([3, 0, 3]),
    4,
  )!;
  expect(result).toEqual(
    Uint8Array.from([9, 10, 11, 255, 0, 1, 2, 255, 9, 10, 11, 255]),
  );
  expect(result.buffer).not.toBe(pointColors.buffer);
  expect(reindexPointColors(pointColors, new Uint32Array(), 4)).toHaveLength(0);
  expect(() =>
    reindexPointColors(pointColors, Uint32Array.from([4]), 4),
  ).toThrow(/index|slot/i);
  expect(pointColors).toEqual(before);
});

it.each([
  ["delete", [0, 2]],
  ["extract", [1, 3]],
  ["voxel", [0, 2]],
  ["sampleCount", [0, 2]],
] as const)(
  "%s preserves color correspondence using actual sourceIndices",
  (action, expected) => {
    const before = pointColors.slice();
    const result = editPointCloud({
      ...common,
      action,
      ...(action === "delete" || action === "extract"
        ? { selection: Uint8Array.from([0, 1, 0, 1]) }
        : { cellSize: 0.5, targetPoints: 2 }),
    });
    expect(Array.from(result.sourceIndices!)).toEqual(expected);
    expect(result.pointColors).toEqual(
      Uint8Array.from(
        expected.flatMap((index) =>
          Array.from(pointColors.subarray(index * 4, index * 4 + 4)),
        ),
      ),
    );
    expect(pointColors).toEqual(before);
  },
);

it("smoothing retains every color slot without a redundant copy", () => {
  const result = editPointCloud({
    ...common,
    action: "smooth",
    neighborRadius: 0.5,
  });
  expect(result.positions).toHaveLength(positions.length);
  expect(result.sourceIndices).toBeUndefined();
  expect(result.pointColors).toBe(pointColors);
});

it("deleting all points returns an empty color view and selection-only edits retain authored data", () => {
  const result = editPointCloud({
    ...common,
    action: "delete",
    selection: new Uint8Array(4).fill(1),
  });
  expect(result.positions).toHaveLength(0);
  expect(result.pointColors).toHaveLength(0);
  const selection = editPointCloud({
    ...common,
    action: "grow",
    selection: Uint8Array.from([1, 0, 0, 0]),
    neighborRadius: 0.5,
  });
  expect(selection.positions).toBeUndefined();
  expect(selection.pointColors).toBeUndefined();
  expect(pointColors).toHaveLength(16);
});

class WorkerDouble {
  static latest: WorkerDouble;
  static creates = 0;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror = null;
  onmessageerror = null;
  sent?: ProcessingRequest;
  transfers: Transferable[] = [];
  terminated = false;
  constructor() {
    WorkerDouble.latest = this;
    WorkerDouble.creates++;
  }
  postMessage(request: ProcessingRequest, transfers: Transferable[]) {
    this.sent = request;
    this.transfers = transfers;
  }
  terminate() {
    this.terminated = true;
  }
  reply(pointCloudEdit: Record<string, unknown>) {
    this.onmessage?.({
      data: {
        result: { kind: "pointCloudEdit", pointCloudEdit, diagnostics: {} },
      },
    });
  }
}

it("keeps authored colors out of worker transport and reindexes once after publication", async () => {
  vi.stubGlobal("Worker", WorkerDouble);
  const pending = processMesh({
    ...common,
    action: "extract",
    selection: Uint8Array.from([0, 1, 0, 1]),
  });
  const worker = WorkerDouble.latest;
  expect(worker.sent).not.toHaveProperty("pointColors");
  expect(worker.transfers).not.toContain(pointColors.buffer);
  worker.reply({
    positions: new Float32Array(6),
    sourceIndices: Uint32Array.from([1, 3]),
    diagnostics: {},
  });
  const result = await pending;
  expect(result.pointCloudEdit?.pointColors).toEqual(
    Uint8Array.from([3, 4, 5, 255, 9, 10, 11, 255]),
  );
  expect(pointColors.byteLength).toBe(16);
  expect(worker.terminated).toBe(true);
});

it("rejects invalid colors before creating a worker", async () => {
  vi.stubGlobal("Worker", WorkerDouble);
  const before = WorkerDouble.creates;
  const pending = processMesh({
    ...common,
    action: "delete",
    pointColors: new Uint8Array(4),
  });
  if (WorkerDouble.creates !== before)
    WorkerDouble.latest.reply({
      positions: new Float32Array(3),
      sourceIndices: Uint32Array.from([0]),
      diagnostics: {},
    });
  await expect(pending).rejects.toThrow(/color/i);
  expect(WorkerDouble.creates).toBe(before);
});

it("does not transport or copy shared source colors when smoothing", async () => {
  vi.stubGlobal("Worker", WorkerDouble);
  const shared = new Uint8Array(new SharedArrayBuffer(pointColors.length));
  shared.set(pointColors);
  const pending = processMesh({
    ...common,
    pointColors: shared,
    action: "smooth",
  });
  const worker = WorkerDouble.latest;
  expect(worker.sent).not.toHaveProperty("pointColors");
  expect(worker.transfers).not.toContain(shared.buffer);
  worker.reply({ positions: positions.slice(), diagnostics: {} });
  expect((await pending).pointCloudEdit?.pointColors).toBe(shared);
  expect(shared).toEqual(pointColors);
});

it("rejects missing or invalid worker correspondence and cleans up", async () => {
  vi.stubGlobal("Worker", WorkerDouble);
  for (const sourceIndices of [
    undefined,
    Uint32Array.from([4]),
    Uint32Array.from([0, 1]),
  ]) {
    const pending = processMesh({ ...common, action: "extract" });
    const rejection = expect(pending).rejects.toThrow(
      /index|slot|correspondence/i,
    );
    const worker = WorkerDouble.latest;
    worker.reply({
      positions: new Float32Array(3),
      sourceIndices,
      diagnostics: {},
    });
    await rejection;
    expect(worker.terminated).toBe(true);
  }
});
