import { expect, it } from "vitest";
import { exportStl } from "../src/io";
import type { Entity } from "../src/types";

const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const mesh: Entity = {
  id: "mesh",
  name: "mesh",
  kind: "mesh",
  positions,
  indexedMesh: {
    vertices: positions,
    triangles: new Uint32Array([0, 1, 2]),
    geometryNormals: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    normals: new Float32Array([0, 0, -1, 0, 0, -1, 0, 0, -1]),
  },
  color: "#ffffff",
  visible: true,
  opacity: 1,
};

it("writes the native Float32 mean of indexed geometry normals without altering the source", () => {
  const output = exportStl([mesh]);
  const third = Math.fround(1 / 3);
  expect([0, 1, 2].map((i) => output.getFloat32(84 + 4 * i, true))).toEqual([
    third,
    third,
    third,
  ]);
  expect(Array.from(mesh.positions)).toEqual(Array.from(positions));
  expect(Array.from(mesh.indexedMesh!.geometryNormals!)).toEqual([
    1, 0, 0, 0, 1, 0, 0, 0, 1,
  ]);
});

it("keeps geometric normals when indexed topology is missing or stale", () => {
  const stale = {
    ...mesh,
    indexedMesh: {
      ...mesh.indexedMesh!,
      vertices: new Float32Array([0, 0, 0, 2, 0, 0, 0, 1, 0]),
    },
  };
  const output = exportStl([{ ...mesh, indexedMesh: undefined }, stale]);
  expect(output.getUint32(80, true)).toBe(2);
  for (const offset of [84, 134])
    expect(
      [0, 1, 2].map((i) => output.getFloat32(offset + 4 * i, true)),
    ).toEqual([0, 0, 1]);
});

it("keeps facet offsets correct across mixed indexed and unindexed objects", () => {
  const cloud: Entity = {
    ...mesh,
    id: "cloud",
    kind: "pointcloud",
    indexedMesh: undefined,
  };
  const output = exportStl([{ ...mesh, indexedMesh: undefined }, cloud, mesh]);
  expect(output.getUint32(80, true)).toBe(2);
  const normalAt = (offset: number) =>
    [0, 1, 2].map((axis) => output.getFloat32(offset + axis * 4, true));
  expect(normalAt(84)).toEqual([0, 0, 1]);
  expect(normalAt(134)).toEqual(Array(3).fill(Math.fround(1 / 3)));
});
