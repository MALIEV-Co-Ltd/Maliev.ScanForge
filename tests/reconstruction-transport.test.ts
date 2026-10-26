import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { processMesh, type ProcessingRequest } from "../src/processing-client";
import { releaseProcessingSession } from "../src/processing-session";

class WorkerDouble {
  static instances: WorkerDouble[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  sent?: ProcessingRequest;
  delivered?: ProcessingRequest;
  transfers: Transferable[] = [];
  terminated = false;
  constructor() {
    WorkerDouble.instances.push(this);
  }
  postMessage(request: ProcessingRequest, transfers: Transferable[]) {
    this.sent = request;
    this.transfers = transfers;
    this.delivered = structuredClone(request, { transfer: transfers });
  }
  terminate() {
    this.terminated = true;
  }
  complete() {
    this.onmessage?.({
      data: {
        result: {
          kind: "scanTools",
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          diagnostics: {},
        },
      },
    });
  }
}
const values = [0, 0, 0, 1, 0, 0, 0, 1, 0];
function shared() {
  const backing = new SharedArrayBuffer(18 * 4);
  const view = new Float32Array(backing, 9 * 4, 9);
  view.set(values);
  return view;
}
function reconstruct(
  positions: number[] | Float32Array,
  targets: (number[] | Float32Array)[] = [],
): ProcessingRequest {
  return {
    kind: "scanTools",
    positions,
    operation: { kind: "repolygonize", resolution: 0.5, targets },
  };
}
async function started() {
  for (let i = 0; i < 20 && !WorkerDouble.instances.length; i++)
    await Promise.resolve();
  expect(WorkerDouble.instances).toHaveLength(1);
  return WorkerDouble.instances[0];
}
beforeEach(() => {
  vi.useFakeTimers();
  WorkerDouble.instances = [];
  vi.stubGlobal("Worker", WorkerDouble);
});
afterEach(() => {
  releaseProcessingSession();
  vi.unstubAllGlobals();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

it("borrows exact immutable SAB subviews for every reconstruction input without transfers", async () => {
  const source = shared(),
    target = shared();
  const beforeSource = Array.from(source),
    beforeTarget = Array.from(target);
  const pending = processMesh(reconstruct(source, [target]));
  const worker = await started();
  expect(worker.sent?.positions).toBe(source);
  if (
    worker.sent?.kind !== "scanTools" ||
    worker.sent.operation.kind !== "repolygonize"
  )
    throw Error("Wrong request");
  expect(worker.sent.operation.targets?.[0]).toBe(target);
  expect(worker.transfers).toEqual([]);
  expect(worker.delivered?.positions).toEqual(source);
  expect(worker.delivered?.positions).toBeInstanceOf(Float32Array);
  if (!(worker.delivered?.positions instanceof Float32Array))
    throw Error("Wrong positions");
  expect(worker.delivered.positions.buffer).toBeInstanceOf(SharedArrayBuffer);
  expect(worker.delivered.positions.byteLength).toBe(source.byteLength);
  worker.complete();
  await pending;
  expect(worker.terminated).toBe(true);
  expect(Array.from(source)).toEqual(beforeSource);
  expect(Array.from(target)).toEqual(beforeTarget);
});

it("uses a disposable worker even if a caller requests reusable topology", async () => {
  const pending = processMesh(reconstruct(shared()), { reuseTopology: true });
  const worker = await started();
  worker.complete();
  await pending;
  expect(worker.terminated).toBe(true);
  expect(worker.sent).not.toHaveProperty("geometryKey");
});

it.each(["ordinary", "array"])(
  "keeps %s fallback inputs private and authored geometry attached",
  async (mode) => {
    const source = mode === "array" ? [...values] : Float32Array.from(values);
    const target = Float32Array.from(values),
      sourceBefore = Array.from(source),
      targetBefore = Array.from(target);
    const pending = processMesh(reconstruct(source, [target]));
    const worker = await started();
    expect(worker.sent?.positions === source).toBe(false);
    expect(Array.from(worker.delivered!.positions)).toEqual(sourceBefore);
    if (
      worker.delivered?.kind !== "scanTools" ||
      worker.delivered.operation.kind !== "repolygonize"
    )
      throw Error("Wrong request");
    expect(Array.from(worker.delivered.operation.targets![0])).toEqual(
      targetBefore,
    );
    expect(worker.delivered.operation.targets![0]).not.toBe(target);
    expect(worker.transfers.length).toBe(mode === "array" ? 1 : 2);
    worker.complete();
    await pending;
    expect(Array.from(source)).toEqual(sourceBefore);
    expect(Array.from(target)).toEqual(targetBefore);
  },
);

it("does not borrow shared buffers for mutating scan tools", async () => {
  const source = shared();
  const pending = processMesh({
    kind: "scanTools",
    positions: source,
    operation: { kind: "flipNormals" },
  });
  const worker = await started();
  expect(worker.sent?.positions === source).toBe(false);
  expect(worker.delivered?.positions).toBeInstanceOf(Float32Array);
  expect((worker.delivered?.positions as Float32Array).buffer).toBeInstanceOf(
    ArrayBuffer,
  );
  expect(worker.transfers).toHaveLength(1);
  worker.complete();
  await pending;
  expect(Array.from(source)).toEqual(values);
});

it.each(["cancel", "error"])(
  "retires borrowed reconstruction ownership after %s without detaching inputs",
  async (end) => {
    const source = shared(),
      target = shared(),
      controller = new AbortController();
    const pending = processMesh(reconstruct(source, [target]), {
      signal: controller.signal,
    });
    const worker = await started();
    if (end === "cancel") controller.abort();
    else worker.onmessage?.({ data: { error: "preflight failed" } });
    await expect(pending).rejects.toThrow();
    expect(worker.terminated).toBe(true);
    expect(Array.from(source)).toEqual(values);
    expect(Array.from(target)).toEqual(values);
  },
);

it("rejects oversized private payload before cloning or creating a worker", async () => {
  const source = new Proxy([] as number[], {
    get(target, key, receiver) {
      if (key === "length") return 59_968_476;
      if (typeof key === "string" && /^\d+$/.test(key))
        throw Error("Scalar read before admission");
      return Reflect.get(target, key, receiver);
    },
  });
  await expect(processMesh(reconstruct(source))).rejects.toThrow(
    /private.*(payload|bytes|limit)|copy.*limit/i,
  );
  expect(WorkerDouble.instances).toHaveLength(0);
});

it.each([true, false])(
  "preserves typed mixed reconstruction records with shared=%s",
  async (borrow) => {
    const source = borrow
      ? shared().subarray(0, 3)
      : new Float32Array([0, 0, 0]);
    const target = borrow
      ? shared().subarray(0, 6)
      : new Float32Array([1, 0, 0, 2, 0, 0]);
    const before = Array.from(target);
    const pending = processMesh({
      kind: "scanTools",
      positions: source,
      operation: {
        kind: "repolygonize",
        inputKind: "points",
        targetInputs: [{ kind: "points", positions: target }],
      },
    });
    const worker = await started();
    const request = worker.delivered!;
    if (
      request.kind !== "scanTools" ||
      request.operation.kind !== "repolygonize"
    )
      throw Error("Wrong request");
    expect(request.operation.inputKind).toBe("points");
    expect(request.operation.targetInputs?.[0].kind).toBe("points");
    const delivered = request.operation.targetInputs![0]
      .positions as Float32Array;
    expect(Array.from(delivered)).toEqual(before);
    expect(delivered.buffer).toBeInstanceOf(
      borrow ? SharedArrayBuffer : ArrayBuffer,
    );
    expect(worker.transfers).toHaveLength(borrow ? 0 : 2);
    if (borrow) expect(delivered.byteOffset).toBe(target.byteOffset);
    worker.complete();
    await pending;
    expect(worker.terminated).toBe(true);
    expect(Array.from(target)).toEqual(before);
  },
);

it("rejects ambiguous typed and legacy targets before worker creation", async () => {
  await expect(
    processMesh({
      kind: "scanTools",
      positions: new Float32Array([0, 0, 0]),
      operation: {
        kind: "repolygonize",
        inputKind: "points",
        targets: [],
        targetInputs: [],
      },
    }),
  ).rejects.toThrow(/one.*representation/);
  expect(WorkerDouble.instances).toHaveLength(0);
});

it.each([true, false])(
  "preserves native indexed normal carriers with shared=%s without detaching authored buffers",
  async (borrow) => {
    const floats = () => (borrow ? shared() : Float32Array.from(values));
    const topology = () => {
      const triangles = borrow
        ? new Uint32Array(new SharedArrayBuffer(12))
        : new Uint32Array(3);
      triangles.set([0, 1, 2]);
      return {
        vertices: floats(),
        triangles,
        normals: floats(),
        geometryNormals: floats(),
        facetNormals: floats().subarray(0, 3),
      };
    };
    const source = floats(),
      target = floats();
    const sourceTopology = topology(),
      targetTopology = topology();
    const pending = processMesh({
      kind: "scanTools",
      positions: source,
      operation: {
        kind: "repolygonize",
        method: "native",
        targets: [target],
        sourceTopology,
        targetTopology: [targetTopology],
      },
    });
    const worker = await started(),
      delivered = worker.delivered;
    if (
      delivered?.kind !== "scanTools" ||
      delivered.operation.kind !== "repolygonize"
    )
      throw Error("Wrong request");
    expect(worker.transfers).toHaveLength(borrow ? 2 : 12);
    for (const [original, result] of [
      [sourceTopology, delivered.operation.sourceTopology],
      [targetTopology, delivered.operation.targetTopology?.[0]],
    ] as const) {
      expect(result).toBeDefined();
      for (const key of [
        "vertices",
        "normals",
        "geometryNormals",
        "facetNormals",
      ] as const) {
        const before = original[key],
          after = result![key] as Float32Array;
        expect(after).toEqual(before);
        expect(after.buffer).toBeInstanceOf(
          borrow ? SharedArrayBuffer : ArrayBuffer,
        );
        expect(before.byteLength).toBe(key === "facetNormals" ? 12 : 36);
        if (borrow) expect(after.byteOffset).toBe(before.byteOffset);
      }
      expect(result!.triangles).toEqual(new Uint32Array([0, 1, 2]));
      expect((result!.triangles as Uint32Array).buffer).toBeInstanceOf(
        ArrayBuffer,
      );
      expect(original.triangles.byteLength).toBe(12);
      expect(original.triangles).toEqual(new Uint32Array([0, 1, 2]));
    }
    if (
      worker.sent?.kind !== "scanTools" ||
      worker.sent.operation.kind !== "repolygonize"
    )
      throw Error("Wrong sent request");
    expect(
      worker.sent.operation.sourceTopology!.vertices ===
        sourceTopology.vertices,
    ).toBe(borrow);
    expect(
      worker.sent.operation.sourceTopology!.facetNormals ===
        sourceTopology.facetNormals,
    ).toBe(borrow);
    worker.complete();
    await pending;
    expect(worker.terminated).toBe(true);
    expect(source).toEqual(Float32Array.from(values));
    expect(target).toEqual(Float32Array.from(values));
  },
);

it("rejects oversized native indexed payload before any clone or worker", async () => {
  const unread = new Proxy<number[]>([], {
    get(_target, key) {
      if (key === "length") return 150_000_000;
      throw Error("Indexed scalar read before admission");
    },
  });
  await expect(
    processMesh({
      kind: "scanTools",
      positions: shared(),
      operation: {
        kind: "repolygonize",
        method: "native",
        sourceTopology: {
          vertices: unread,
          triangles: new Uint32Array([0, 1, 2]),
        },
      },
    }),
  ).rejects.toThrow(/topology exceeds 256 MiB/);
  expect(WorkerDouble.instances).toHaveLength(0);
});

it("rejects explicit native point inputs before creating a worker", async () => {
  await expect(
    processMesh({
      kind: "scanTools",
      positions: shared().subarray(0, 3),
      operation: {
        kind: "repolygonize",
        inputKind: "points",
        method: "native",
      },
    }),
  ).rejects.toThrow(/triangle meshes/);
  expect(WorkerDouble.instances).toHaveLength(0);
});

it("rejects an invalid typed record kind before cloning or creating a worker", async () => {
  let failure: unknown;
  const pending = processMesh({
    kind: "scanTools",
    positions: shared(),
    operation: {
      kind: "repolygonize",
      inputKind: "invalid" as "triangles",
    },
  }).catch((error) => {
    failure = error;
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  try {
    expect(WorkerDouble.instances).toHaveLength(0);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/complete triangles/);
  } finally {
    for (const worker of WorkerDouble.instances) worker.complete();
    await pending;
  }
});
