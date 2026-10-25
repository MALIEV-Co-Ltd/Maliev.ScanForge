import { afterEach, expect, it, vi } from "vitest";
import type { IndexedMesh } from "../src/types";
import { expandPlyTopology } from "../src/ply-topology";
import { processMesh, type ProcessingRequest } from "../src/processing-client";
import { rotateIndexedNormals } from "../src/indexed-mesh";
import { transformDatumCoordinates } from "../src/datum-transform-kernel";
import { refineNativeSurface } from "../src/native-surface-refinement";
import { refineNativeLandmarkAfterCoarse } from "../src/native-landmark-refinement";
import * as controller from "../src/scan-native-alignment-surface-controller";
import { noiseNormals } from "../src/scan-native-noise";

const matrix = [0, -1, 0, 3, 1, 0, 0, 2, 0, 0, 1, 1];
const bits = (v: ArrayLike<number>) =>
  Buffer.from(Float32Array.from(v).buffer).toString("hex");
function mesh(): IndexedMesh {
  return {
    vertices: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
    triangles: new Uint32Array([0, 1, 2]),
    normals: new Float32Array(9).fill(2),
    geometryNormals: new Float32Array([
      0.1, 0.2, 0.3, -0.25, 0.5, 0.75, 1, -2, 3,
    ]),
  };
}
const search = () => ({
  accepted: true,
  matrix,
  parameters: [0, 0, 0, 0, 0, 0],
  initialError: 1,
  best: 0,
  iterations: 1,
  error: 0,
  converged: true,
  flags: [],
  physicalWorkers: 0,
  logicalLanes: 1,
  fallbackReason: "Test serial execution",
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["nativeRefine", "paired", "icp", "global"] as const)(
  "clones computed fields without detaching scene data on the %s worker route",
  async (kind) => {
    const source = mesh(),
      target = mesh(),
      positions = expandPlyTopology(source),
      targetPositions = expandPlyTopology(target);
    const before = bits(source.geometryNormals!);
    let received: any,
      terminated = false;
    vi.stubGlobal(
      "Worker",
      class {
        postMessage(packet: unknown, transfer: Transferable[]) {
          received = structuredClone(packet, { transfer });
        }
        terminate() {
          terminated = true;
        }
      },
    );
    const request = (
      kind === "nativeRefine"
        ? {
            kind,
            positions,
            target: targetPositions,
            sourceIndexed: source,
            targetIndexed: target,
            additionalTargets: [
              { positions: targetPositions, indexedMesh: target },
            ],
            sampleBudget: 10,
            initialRadius: 0.5,
          }
        : kind === "paired"
          ? {
              kind,
              positions,
              sourceIndexed: source,
              sourceLandmarks: Array.from(source.vertices),
              targetLandmarks: Array.from(target.vertices),
              refinementTargets: [
                { positions: targetPositions, indexedMesh: target },
              ],
            }
          : {
              kind,
              positions,
              target: targetPositions,
              sourceIndexed: source,
              maxDistance: 1,
              maxIterations: 1,
              sampleSize: 3,
              targetSampleSize: 3,
              tolerance: 0.001,
              trimFraction: 0,
            }
    ) as ProcessingRequest;
    const abort = new AbortController();
    const pending = processMesh(request, { signal: abort.signal });
    // Cancel before making assertions so a regression cannot leave a test-owned worker alive.
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(terminated).toBe(true);
    expect(received.sourceIndexed.geometryNormals).toBeInstanceOf(Float32Array);
    expect(bits(received.sourceIndexed.geometryNormals)).toBe(before);
    expect(received.sourceIndexed.geometryNormals.buffer).not.toBe(
      (source.geometryNormals as Float32Array).buffer,
    );
    if (kind === "nativeRefine") {
      expect(received.targetIndexed.geometryNormals).toEqual(
        target.geometryNormals,
      );
      expect(received.additionalTargets[0].indexedMesh.geometryNormals).toEqual(
        target.geometryNormals,
      );
    }
    if (kind === "paired")
      expect(received.refinementTargets[0].indexedMesh.geometryNormals).toEqual(
        target.geometryNormals,
      );
    expect(bits(source.geometryNormals!)).toBe(before);
  },
);

it("uses computed source vectors in surface refinement and retains distinct authored vectors", () => {
  const source = mesh(),
    target = mesh(),
    before = bits(source.geometryNormals!);
  const spy = vi
    .spyOn(controller, "nativeRefineAlignmentMeshes")
    .mockReturnValueOnce(search());
  const result = refineNativeSurface(
    {
      kind: "nativeRefine",
      positions: expandPlyTopology(source),
      target: expandPlyTopology(target),
      sourceIndexed: source,
      targetIndexed: target,
      sampleBudget: 10,
      initialRadius: 0.5,
    },
    vi.fn(),
  );
  expect(spy.mock.calls[0][0][0].normals).toBe(source.geometryNormals);
  expect(result.indexedMesh!.geometryNormals).toBeInstanceOf(Float32Array);
  expect(bits(result.indexedMesh!.geometryNormals!)).toBe(
    bits(transformDatumCoordinates(source.geometryNormals!, matrix, true)),
  );
  expect(bits(result.indexedMesh!.normals!)).toBe(
    bits(transformDatumCoordinates(source.normals!, matrix, true)),
  );
  expect(bits(source.geometryNormals!)).toBe(before);
});

it.each([true, false])(
  "keeps coarse and refinement computed stages separate from scanner data (stored=%s)",
  async (stored) => {
    const source = mesh(),
      target = mesh();
    if (!stored) delete source.geometryNormals;
    const expected = source.geometryNormals ?? noiseNormals(source);
    const coarse = [
      1, 0, 0, 0.1, 0, 0.8660254037844387, -0.5, 0.2, 0, 0.5,
      0.8660254037844387, 0.3,
    ];
    const spy = vi
      .spyOn(controller, "nativeRefineAlignmentMeshesAsync")
      .mockResolvedValueOnce(search());
    const result = await refineNativeLandmarkAfterCoarse(
      source,
      [target],
      coarse,
      [0, 1, 2],
    );
    expect(bits(spy.mock.calls[0][0][0].normals!)).toBe(
      bits(transformDatumCoordinates(expected, coarse, true)),
    );
    expect(bits(result.indexedMesh.geometryNormals!)).toBe(
      bits(
        transformDatumCoordinates(
          transformDatumCoordinates(expected, coarse, true),
          matrix,
          true,
        ),
      ),
    );
    expect(bits(result.indexedMesh.normals!)).toBe(
      bits(
        transformDatumCoordinates(
          transformDatumCoordinates(source.normals!, coarse, true),
          matrix,
          true,
        ),
      ),
    );
    expect(source.geometryNormals !== undefined).toBe(stored);
  },
);

it("returns computed normals and compact display through the actual paired processing worker", async () => {
  let result: any,
    error: string | undefined,
    transfers: Transferable[] = [];
  const scope = {
    onmessage: undefined as any,
    postMessage(message: any, transfer: Transferable[] = []) {
      if (message.error) error = message.error;
      if (message.result) {
        transfers = transfer;
        result = structuredClone(message.result, { transfer });
      }
    },
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("../src/processing-worker");
  const source = mesh(),
    original = Float32Array.from(source.geometryNormals!);
  source.vertices = Float32Array.from(source.vertices, (value) => value * 10);
  await scope.onmessage({
    data: {
      kind: "paired",
      positions: expandPlyTopology(source),
      sourceIndexed: source,
      sourceLandmarks: Array.from(source.vertices),
      targetLandmarks: Array.from(
        source.vertices,
        (v, i) => v + [1, 2, 3][i % 3],
      ),
    },
  });
  expect(error).toBeUndefined();
  expect(result.indexedMesh.geometryNormals).toBeInstanceOf(Float32Array);
  expect(bits(result.indexedMesh.geometryNormals)).toBe(
    bits(
      rotateIndexedNormals(original, result.registration.transform.rotation),
    ),
  );
  expect(result.renderData.indexedMesh).toBe(result.indexedMesh);
  expect(result.renderData.normals).toBe(result.indexedMesh.geometryNormals);
  expect(new Set(transfers).size).toBe(transfers.length);
  expect(bits(source.geometryNormals!)).toBe(bits(original));
});
