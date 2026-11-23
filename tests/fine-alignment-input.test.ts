import { expect, it } from "vitest";
import { fineAlignmentInput } from "../src/fine-alignment-input";
import type { Entity } from "../src/types";

const triangle = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const entity = (overrides: Partial<Entity> = {}): Entity => ({
  id: `mesh-${nextId++}`,
  name: "mesh",
  kind: "mesh",
  positions: triangle,
  visible: true,
  opacity: 1,
  color: "#fff",
  ...overrides,
});

let nextId = 0;

it("rejects registering an object against itself", () => {
  const source = entity();
  expect(() => fineAlignmentInput(source, { ...source })).toThrow(
    /different fixed/i,
  );
});

it("retains original indexed references while excluding fixed hidden faces", () => {
  const positions = [...triangle, 1, 0, 0, 1, 1, 0, 0, 1, 0];
  const indexedMesh = {
    vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0],
    triangles: new Uint32Array([0, 1, 2, 1, 3, 2]),
  };
  const fixed = entity({
    positions,
    indexedMesh,
    meshSelection: { hidden: [0], saved: [] },
  });
  const source = entity({ normals: [0, 0, 2, 0, 0, 2, 0, 0, 2] });
  const result = fineAlignmentInput(source, fixed);
  expect(result.sourceNormals).toBe(source.normals);
  expect(result.targetSurface?.vertices).toBe(indexedMesh.vertices);
  expect(result.targetSurface?.triangles).toEqual(new Uint32Array([1, 3, 2]));
  expect(indexedMesh.triangles).toEqual(new Uint32Array([0, 1, 2, 1, 3, 2]));
  expect(fixed.meshSelection?.hidden).toEqual([0]);
});

it("rejects stale indexed topology and fully hidden fixed meshes before solving", () => {
  expect(() =>
    fineAlignmentInput(
      entity(),
      entity({
        indexedMesh: {
          vertices: triangle.map((x) => x + 1),
          triangles: [0, 1, 2],
        },
      }),
    ),
  ).toThrow(/topology/);
  expect(() =>
    fineAlignmentInput(
      entity(),
      entity({ meshSelection: { hidden: [0], saved: [] } }),
    ),
  ).toThrow(/No visible triangles/);
});

it("uses optional cloud normals without inventing cloud surface topology", () => {
  const source = entity({ kind: "pointcloud", normals: triangle });
  const fixed = entity({ kind: "pointcloud", normals: triangle });
  expect(fineAlignmentInput(source, fixed)).toEqual({
    sourceNormals: triangle,
    targetNormals: triangle,
  });
  expect(
    fineAlignmentInput(
      entity({ kind: "pointcloud" }),
      entity({ kind: "pointcloud" }),
    ),
  ).toEqual({ sourceNormals: undefined, targetNormals: undefined });
});
