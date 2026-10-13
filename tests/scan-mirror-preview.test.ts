import { afterEach, expect, it, vi } from "vitest";
import { ScanPreviewSession } from "../src/scan-preview";
import { mirroredMeshCopy } from "../src/scan-scaled-copy";
import type { Entity, Vec3 } from "../src/types";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";
import capture from "./fixtures/mirror-coordinate-native.json";

const decode = (hex: string) =>
  new Float32Array(
    Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16)).buffer,
  );
const bits = (p: Float32Array) =>
  Array.from(new Uint8Array(p.buffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const operation = (entry: (typeof capture.cases)[number]) => ({
  kind: "mirrorMesh" as const,
  center: entry.plane.center as Vec3,
  normal: (entry.plane.inputNormal ?? entry.plane.normal) as Vec3,
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(capture.cases)(
  "previews and copies native $name mirror on $plane.name while retaining source",
  async (entry) => {
    const positions = decode(entry.inputBits);
    const stages: string[] = [];
    const cache = {};
    const preview = await ScanPreviewSession.create(
      {
        kind: "scanPreview",
        phase: "create",
        previewId: "mirror",
        positions,
        operation: operation(entry),
      },
      { topologyCache: cache, onProgress: (_, stage) => stages.push(stage) },
    );
    expect(bits(preview.output)).toBe(entry.nativeBits);
    expect(bits(positions)).toBe(entry.inputBits);
    expect(cache).toEqual({});
    expect(
      stages.some((stage) => /Welding|Building topology/.test(stage)),
    ).toBe(false);
    expect(() => preview.compare(0.05)).toThrow(
      "Mirror preview does not support",
    );
    const source: Entity = {
      id: "source",
      name: "Scan",
      kind: "mesh",
      positions,
      color: "#778899",
      opacity: 0.7,
      visible: true,
      normals: [1, 0, 0],
      edgePositions: [0, 0, 0],
      surfaceScanId: "old-fit",
      scanSource: { bytes: 1, triangles: 2, displayedTriangles: 1 },
      source: "fixture.stl",
    };
    const copy = mirroredMeshCopy(source, preview.output, "copy");
    expect(copy).toEqual({
      id: "copy",
      name: "Scan (mirrored)",
      kind: "mesh",
      positions: preview.output,
      color: source.color,
      opacity: source.opacity,
      visible: true,
      source: source.source,
    });
    expect(bits(copy.positions)).toBe(entry.nativeBits);
    expect(bits(positions)).toBe(entry.inputBits);
    expect(source.normals).toEqual([1, 0, 0]);
  },
);

it("reused worker previews switch planes without compounding or detaching canonical coordinates", async () => {
  vi.useFakeTimers();
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      ((e: { data: ProcessingRequest }) => Promise<void>) | null,
    postMessage(message: ProcessingResponse, transfers?: Transferable[]) {
      replies.push(structuredClone(message, { transfer: transfers ?? [] }));
    },
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("../src/processing-worker");
  const cases = capture.cases.filter((c) => c.name === "annular");
  const positions = decode(cases[0].inputBits);
  for (const [index, entry] of [...cases, cases[0]].entries()) {
    replies.length = 0;
    await scope.onmessage!({
      data: {
        kind: "scanPreview",
        phase: "create",
        previewId: `mirror-${index}`,
        positions: index ? new Float32Array() : positions,
        geometryKey: 99,
        operation: operation(entry),
      } as ProcessingRequest,
    });
    const final = replies.at(-1)!;
    if (!("result" in final)) throw new Error("Missing mirror preview");
    expect(bits(final.result.positions!)).toBe(entry.nativeBits);
    expect(bits(positions)).toBe(cases[0].inputBits);
    expect(
      replies.some(
        (m) => "stage" in m && /Welding|Building topology/.test(m.stage),
      ),
    ).toBe(false);
  }
});

it("rejects invalid mirror copies and cancelled previews without editing source", async () => {
  const entry = capture.cases[0],
    positions = decode(entry.inputBits);
  const source: Entity = {
    id: "source",
    name: "Scan",
    kind: "mesh",
    positions,
    color: "#aaa",
    opacity: 1,
    visible: true,
  };
  for (const id of ["", "source"])
    expect(() => mirroredMeshCopy(source, positions, id)).toThrow("distinct");
  for (const p of [
    new Float32Array(),
    new Float32Array(positions.length).fill(NaN),
  ])
    expect(() => mirroredMeshCopy(source, p, "copy")).toThrow("does not match");
  expect(() =>
    mirroredMeshCopy({ ...source, kernelId: "exact" }, positions, "copy"),
  ).toThrow("mesh source");
  const controller = new AbortController();
  controller.abort();
  await expect(
    ScanPreviewSession.create(
      {
        kind: "scanPreview",
        phase: "create",
        previewId: "cancel",
        positions,
        operation: operation(entry),
      },
      { signal: controller.signal },
    ),
  ).rejects.toThrow("cancelled");
  expect(bits(positions)).toBe(entry.inputBits);
});
