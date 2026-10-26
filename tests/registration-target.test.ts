import { expect, it } from "vitest";
import { registrationTargetPoints } from "../src/registration-target";
import type { Entity } from "../src/types";

function mesh(): Entity {
  return {
    id: "target",
    name: "Target",
    kind: "mesh",
    visible: true,
    color: "#aaa",
    opacity: 1,
    positions: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]),
    indexedMesh: {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      triangles: new Uint32Array([0, 1, 2, 0, 1, 2]),
    },
  };
}

it("borrows all referenced canonical points without copying repeated corners", () => {
  const target = mesh();
  expect(registrationTargetPoints(target)).toBe(target.indexedMesh!.vertices);
  expect(target.positions.length).toBe(18);
});

it("excludes unused indexed points while retaining every surface point and input", () => {
  const target = mesh();
  target.indexedMesh!.vertices = new Float32Array([
    0, 0, 0, 10000, 10000, 10000, 1, 0, 0, 0, 1, 0,
  ]);
  target.indexedMesh!.triangles = new Uint32Array([0, 2, 3, 0, 2, 3]);
  const before = target.indexedMesh!.vertices.slice();
  expect(Array.from(registrationTargetPoints(target))).toEqual([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
  ]);
  expect(target.indexedMesh!.vertices).toEqual(before);
});

it("preserves cloud and exact-CAD point carriers and ignores mismatched caches", () => {
  for (const patch of [
    { kind: "pointcloud" as const },
    { kernelId: "exact-target" },
    { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) },
  ]) {
    const target = { ...mesh(), ...patch };
    expect(registrationTargetPoints(target)).toBe(target.positions);
  }
});

it("rejects malformed referenced topology before creating worker input", () => {
  for (const triangles of [
    [0, 1, 9],
    [0, -1, 2],
    [0, 0.5, 2],
  ]) {
    const target = mesh();
    target.positions = target.positions.slice(0, 9);
    target.indexedMesh!.triangles = triangles;
    expect(() => registrationTargetPoints(target)).toThrow(/vertex reference/);
  }
});

it("rejects stale indexed coordinates instead of aligning against a different target", () => {
  const target = mesh();
  target.positions[0] = 50;
  expect(() => registrationTargetPoints(target)).toThrow(/stale/);
});
