import { afterEach, expect, it, vi } from "vitest";
import { registerFineAlignment } from "../src/fine-registration";
import type { FineAlignmentResult } from "../src/fine-registration";
import { processMesh, type ProcessingResult } from "../src/processing-client";
import { processScanRegistration } from "../src/scan-registration";
import type { Entity } from "../src/types";

vi.mock("../src/processing-client", () => ({ processMesh: vi.fn() }));
vi.mock("../src/fine-registration", async (original) => {
  const actual = await original<typeof import("../src/fine-registration")>();
  return {
    ...actual,
    registerFineAlignment: vi.fn(actual.registerFineAlignment),
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function rejection(): FineAlignmentResult {
  return {
    transform: {
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      translation: [0, 0, 0],
    },
    rms: 1,
    wholeCloudRms: 1,
    maxError: 1,
    pairs: 3,
    iterations: 0,
    converged: false,
    targetRmsBasis: "overlap",
    overlapPercent: 85,
    sampleSize: 3,
    fittingSamples: 3,
    overlapRms: null,
    overlapPoints: 0,
    requiredOverlapPoints: 3,
    overlapSatisfied: false,
    targetRms: 0.5,
    targetReached: false,
    terminationReason: "insufficientOverlap",
    matching: "fullTargetSurface",
    normalCompatibility: true,
    rejectedNormalPoints: 3,
    applied: false,
    evaluatedPoints: 3,
    targetPoints: 3,
    rejectedPoints: 3,
    overlapFraction: 0,
    inlierRms: null,
    inlierPairs: 0,
  };
}
const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const request = {
  kind: "icp" as const,
  positions,
  target: positions,
  sourceIndexed: { vertices: positions, triangles: new Uint32Array([0, 1, 2]) },
  maxDistance: 10,
  maxIterations: 200,
  sampleSize: 3,
  targetSampleSize: 3,
  tolerance: 1e-5,
};

it("returns insufficient-overlap diagnostics without publishing mesh or display geometry", async () => {
  const messages: { result?: ProcessingResult; error?: string }[] = [];
  const scope = {
    onmessage: null as unknown as (event: { data: unknown }) => Promise<void>,
    postMessage: (value: (typeof messages)[number]) => messages.push(value),
  };
  vi.stubGlobal("self", scope);
  vi.mocked(registerFineAlignment).mockReturnValueOnce(rejection());
  await import("../src/processing-worker");
  const before = positions.slice();
  await scope.onmessage({ data: request });
  const output = messages.at(-1)!;
  expect(output.error).toBeUndefined();
  expect(output.result?.positions).toBeUndefined();
  expect(output.result?.indexedMesh).toBeUndefined();
  expect(output.result?.renderData).toBeUndefined();
  expect(output.result?.diagnostics).toMatchObject({
    applied: false,
    normalCompatibility: true,
    rejectedNormalPoints: 3,
    terminationReason: "insufficientOverlap",
    overlapRms: null,
    inlierRms: null,
  });
  expect(positions).toEqual(before);
});

it("does not materialize a native cloud pose when fine alignment refuses to apply", async () => {
  const source: Entity = {
    id: "cloud",
    name: "cloud",
    kind: "pointcloud",
    positions,
    visible: true,
    opacity: 1,
    color: "#fff",
  };
  const result: ProcessingResult = {
    kind: "icp",
    registration: rejection(),
    diagnostics: { applied: false },
  };
  vi.mocked(processMesh).mockResolvedValueOnce(result);
  const output = await processScanRegistration(
    source,
    { ...request, sourceIndexed: undefined },
    { parallel: false },
  );
  expect(output).toBe(result);
  expect(output.positions).toBeUndefined();
  expect(output.cloudPreview).toBeUndefined();
  expect(source.pointCloudPlacement).toBeUndefined();
  expect(source.positions).toBe(positions);
});

it.each(["mesh", "pointcloud"] as const)(
  "uses the GUI search distance when an agent omits it for a %s",
  async (kind) => {
    const source: Entity = {
      id: "source",
      name: "source",
      kind,
      positions,
      visible: true,
      opacity: 1,
      color: "#fff",
    };
    const { maxDistance: _distance, ...defaultRequest } = request;
    vi.mocked(processMesh).mockResolvedValueOnce({
      kind: "icp",
      registration: rejection(),
      diagnostics: { applied: false },
    });
    await processScanRegistration(source, defaultRequest as typeof request);
    expect(vi.mocked(processMesh).mock.calls.at(-1)![0]).toMatchObject({
      maxDistance: 10,
    });
  },
);
