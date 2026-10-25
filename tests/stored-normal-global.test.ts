import { afterEach, expect, it, vi } from "vitest";
import {
  globalAlignmentInputAdmission,
  prepareGlobalAlignmentInput,
} from "../src/global-alignment-input";
import { executeGlobalAlignmentInputPreparation } from "../src/global-alignment-input-core";
import type { Entity } from "../src/types";
import { expandPlyTopology } from "../src/ply-topology";

function entity(id: string): Entity {
  const indexedMesh = {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 9, 8, 7]),
    triangles: new Uint32Array([0, 1, 2]),
    normals: new Float32Array(12).fill(2),
    geometryNormals: new Float32Array([
      0.125, -0, 0.25, 0.5, 0.75, 0.125, 1, -2, 3, 0, 0, 0,
    ]),
  };
  return {
    id,
    name: id,
    kind: "mesh",
    visible: true,
    opacity: 1,
    color: "#888888",
    positions: expandPlyTopology(indexedMesh),
    indexedMesh,
  };
}
afterEach(() => vi.unstubAllGlobals());

it("borrows stored computed normals for repeated alignment without a derivation worker", async () => {
  vi.stubGlobal("Worker", undefined);
  const a = entity("a"),
    b = entity("b"),
    before = Float32Array.from(a.indexedMesh!.geometryNormals!);
  const result = await prepareGlobalAlignmentInput([a, b]);
  expect(result.input.scans[0].geometry.normals).toBe(
    a.indexedMesh!.geometryNormals,
  );
  expect(result.input.scans[0].geometry.points).toBe(a.indexedMesh!.vertices);
  expect(result.input.scans[0].geometry.flags).toEqual(new Uint32Array(4));
  expect(result.summary.preparation.physicalWorkers).toBe(0);
  expect(result.entities[0]).toBe(a);
  result.release();
  expect(result.input.scans).toHaveLength(0);
  expect(a.indexedMesh!.geometryNormals).toEqual(before);
  const again = await prepareGlobalAlignmentInput([a, b]);
  expect(again.input.scans[0].geometry.normals).toBe(
    a.indexedMesh!.geometryNormals,
  );
  again.release();
});

it("counts stored carriers once and avoids reserving unused worker topology copies", () => {
  const a = entity("a"),
    b = { ...a, id: "b" };
  const r = globalAlignmentInputAdmission([a, b]);
  const v = a.indexedMesh!.vertices.length * 4,
    t = a.indexedMesh!.triangles.length * 4,
    flags = v / 3;
  expect(r.retainedBytes).toBe(v + t + v + v + 2 * flags);
  expect(r.peakPreparationBytes).toBe(1048576);
  expect(r.estimatedPeakBytes).toBe(r.retainedBytes + 1048576);
  expect(r.limitBytes).toBe(512 * 1048576);
});

it.each([
  [1],
  new Array(12).fill(Infinity),
  new Array(12).fill(1e300),
  new Float64Array(12),
])(
  "rejects malformed stored computed state before any worker",
  async (normals) => {
    const a = entity("a"),
      b = entity("b"),
      construct = vi.fn();
    a.indexedMesh!.geometryNormals = normals as number[];
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          construct();
          throw new Error("Unexpected worker");
        }
      },
    );
    await expect(prepareGlobalAlignmentInput([a, b])).rejects.toThrow(
      /computed normals|finite Float32/,
    );
    expect(construct).not.toHaveBeenCalled();
  },
);

it("carries legacy derived normals into the private acceptance entity without changing the scene", async () => {
  vi.stubGlobal(
    "Worker",
    class {
      onmessage?: (event: any) => void;
      terminate() {}
      postMessage(packet: any, transfer: Transferable[]) {
        const copy = structuredClone(packet, { transfer });
        queueMicrotask(() =>
          this.onmessage?.({
            data: { result: executeGlobalAlignmentInputPreparation(copy) },
          }),
        );
      }
    },
  );
  const a = entity("a"),
    b = entity("b");
  delete a.indexedMesh!.geometryNormals;
  const result = await prepareGlobalAlignmentInput([a, b]);
  const normal = result.input.scans[0].geometry.normals;
  expect(result.entities[0]).not.toBe(a);
  expect(result.entities[0].indexedMesh!.geometryNormals).toBe(normal);
  expect(result.entities[0].indexedMesh!.vertices).toBe(
    a.indexedMesh!.vertices,
  );
  expect(result.entities[0].positions).toBe(a.positions);
  expect(a.indexedMesh!.geometryNormals).toBeUndefined();
  expect(result.summary.preparation.physicalWorkers).toBe(1);
  result.release();
  expect(result.entities[0].indexedMesh!.geometryNormals).toBe(normal);
});
