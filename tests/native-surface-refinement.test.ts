import { afterEach, expect, it, vi } from "vitest";
import native from "./fixtures/alignment-controller-thread.json";
import { expandPlyTopology } from "../src/ply-topology";
import { indexedMeshMatches } from "../src/indexed-mesh";
import {
  refineNativeSurface,
  nativeSurfaceRefinementRequest,
} from "../src/native-surface-refinement";
import type { ProcessingResult } from "../src/processing-client";
import { processMesh } from "../src/processing-client";
import * as nativeController from "../src/scan-native-alignment-surface-controller";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("returns rejection diagnostics without replacement geometry when the native search rejects", () => {
  vi.spyOn(nativeController, "nativeRefineAlignmentMeshes").mockReturnValueOnce(
    {
      parameters: [10, 10, 10, Math.PI / 2, Math.PI / 2, Math.PI / 2],
      error: 1,
      iterations: 1000,
      converged: false,
      initialError: 2,
      best: 1,
      flags: [],
      accepted: false,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    },
  );
  const input = request(native.cases[0]),
    before = [...input.positions];
  const result = refineNativeSurface(input, vi.fn());
  expect(result.refinement.accepted).toBe(false);
  expect(result.positions).toBeUndefined();
  expect(result.indexedMesh).toBeUndefined();
  expect([...input.positions]).toEqual(before);
});
it("copies indexed buffers into the client worker and releases cancellation without detaching scene data", async () => {
  const input = request(native.cases[0]);
  const additional = {
    positions: input.target,
    indexedMesh: input.targetIndexed,
  };
  const grouped = { ...input, additionalTargets: [additional] };
  let sent: typeof input | undefined;
  let terminated = false;
  vi.stubGlobal(
    "Worker",
    class {
      postMessage(value: typeof input) {
        sent = value;
      }
      terminate() {
        terminated = true;
      }
    },
  );
  const controller = new AbortController();
  const pending = processMesh(grouped, { signal: controller.signal });
  const groupSent = sent as typeof grouped;
  expect(groupSent.additionalTargets[0].positions).not.toBe(
    additional.positions,
  );
  expect(groupSent.additionalTargets[0].indexedMesh.vertices).not.toBe(
    additional.indexedMesh.vertices,
  );
  expect(groupSent.additionalTargets[0].indexedMesh.triangles).not.toBe(
    additional.indexedMesh.triangles,
  );
  expect(sent!.sourceIndexed.vertices).not.toBe(input.sourceIndexed.vertices);
  expect(sent!.targetIndexed.triangles).not.toBe(input.targetIndexed.triangles);
  expect(sent!.sourceTriangleMask).not.toBe(input.sourceTriangleMask);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(terminated).toBe(true);
  expect(input.sourceIndexed.vertices.byteLength).toBeGreaterThan(0);
});
function request(sample: (typeof native.cases)[number]) {
  const sourceIndexed = {
    vertices: new Float32Array(sample.search.sourcePoints.flat()),
    triangles: new Uint32Array(sample.search.sourceTriangles),
  };
  const targetIndexed = {
    vertices: new Float32Array(sample.vertices.flat()),
    triangles: new Uint32Array(sample.triangles),
  };
  return {
    kind: "nativeRefine" as const,
    sourceIndexed,
    targetIndexed,
    positions: expandPlyTopology(sourceIndexed),
    target: expandPlyTopology(targetIndexed),
    sampleBudget: 1,
    initialRadius: sample.search.initialRadius,
    sourceTriangleMask: new Uint8Array(sourceIndexed.triangles.length / 3).fill(
      1,
    ),
  };
}
it.each(native.cases)(
  "matches native matrix and search at the real worker boundary: $name",
  async (sample) => {
    const messages: { result?: ProcessingResult; error?: string }[] = [];
    const scope = {
      onmessage: null as unknown as (event: { data: unknown }) => Promise<void>,
      postMessage: (value: (typeof messages)[number]) => messages.push(value),
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("../src/processing-worker");
    const input = request(sample),
      before = [...input.positions];
    await scope.onmessage({ data: input });
    const output = messages.at(-1)!;
    expect(output.error).toBeUndefined();
    expect(output.result!.refinement).toMatchObject({
      matrix: sample.search.matrix,
      parameters: sample.search.parameters,
      accepted: sample.search.accepted,
      best: sample.search.best,
      initialError: sample.search.initialError,
    });
    if (output.result!.positions)
      expect(
        indexedMeshMatches(
          output.result!.indexedMesh,
          output.result!.positions,
        ),
      ).toBe(true);
    expect([...input.positions]).toEqual(before);
    messages.length = 0;
    await scope.onmessage({
      data: {
        ...input,
        additionalTargets: [
          { positions: input.target, indexedMesh: input.targetIndexed },
        ],
      },
    });
    expect(messages.at(-1)!.error).toBeUndefined();
    expect(messages.at(-1)!.result!.refinement).toEqual(
      output.result!.refinement,
    );
  },
);
it("rejects stale geometry, empty selections and invalid sampling before mutation", () => {
  const input = request(native.cases[0]);
  expect(() =>
    refineNativeSurface(
      { ...input, positions: new Float32Array(input.positions.length) },
      vi.fn(),
    ),
  ).toThrow("topology");
  expect(() =>
    refineNativeSurface(
      {
        ...input,
        sourceTriangleMask: new Uint8Array(input.sourceTriangleMask.length),
      },
      vi.fn(),
    ),
  ).toThrow("nonempty");
  expect(() =>
    refineNativeSurface({ ...input, sampleBudget: 0 }, vi.fn()),
  ).toThrow("sampling");
  expect(() =>
    refineNativeSurface(
      {
        ...input,
        additionalTargets: [
          {
            positions: new Float32Array(input.target.length),
            indexedMesh: input.targetIndexed,
          },
        ],
      },
      vi.fn(),
    ),
  ).toThrow("topology");
});
it("requires independent indexed mesh objects and rejects hidden geometry through the shared request", () => {
  const input = request(native.cases[0]);
  const source = {
    id: "source",
    name: "source",
    kind: "mesh" as const,
    visible: true,
    opacity: 1,
    color: "#fff",
    positions: input.positions,
    indexedMesh: input.sourceIndexed,
  };
  const target = {
    ...source,
    id: "target",
    positions: input.target,
    indexedMesh: input.targetIndexed,
  };
  expect(
    nativeSurfaceRefinementRequest(source, target, 500, 10).sourceIndexed,
  ).toBe(source.indexedMesh);
  expect(() => nativeSurfaceRefinementRequest(source, source, 500, 10)).toThrow(
    "different",
  );
  expect(() =>
    nativeSurfaceRefinementRequest(
      { ...source, indexedMesh: undefined },
      target,
      500,
      10,
    ),
  ).toThrow("indexed meshes");
  expect(() =>
    nativeSurfaceRefinementRequest(
      { ...source, meshSelection: { saved: [], hidden: [0] } },
      target,
      500,
      10,
    ),
  ).toThrow("Reveal");
  expect(() => nativeSurfaceRefinementRequest(source, [], 500, 10)).toThrow(
    "distinct",
  );
  expect(() =>
    nativeSurfaceRefinementRequest(
      source,
      [
        target,
        { ...target, id: "hidden", meshSelection: { saved: [], hidden: [0] } },
      ],
      500,
      10,
    ),
  ).toThrow("Reveal");
  expect(() =>
    nativeSurfaceRefinementRequest(
      source,
      [target, { ...target, id: "unindexed", indexedMesh: undefined }],
      500,
      10,
    ),
  ).toThrow("indexed meshes");
});
