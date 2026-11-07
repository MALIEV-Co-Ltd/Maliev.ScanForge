import { expect, it } from "vitest";
import { Vector3 } from "three";
import { createUnrollAuxiliaries } from "../src/scan-unroll-auxiliary";
import { unrollScanMesh } from "../src/scan-tools-transforms";
import { unrollRadialAxis } from "../src/scan-unroll-frame";
import type { Vec3 } from "../src/types";

it.each([
  [
    [0, 0, 1],
    [1, 0, 0],
  ],
  [
    [1, 0, 0],
    [0, 1, 0],
  ],
  [
    [1, 1, 0],
    [0, 0, 1],
  ],
  [
    [1, 1, 1],
    [2, -1, -1],
  ],
])("uses deterministic least-aligned axis ties for %j", (input, expected) => {
  const axis = new Vector3(...(input as Vec3)).normalize();
  const radial = unrollRadialAxis(axis);
  const reference = new Vector3(...(expected as Vec3)).normalize();
  expect(radial.distanceTo(reference)).toBeLessThan(1e-12);
});

it("uses the least-aligned axis for both the unrolled mesh and roll frame", () => {
  // The Y component is strictly smallest; native static selection chooses Y.
  const axis = new Vector3(0.8, 0.2, Math.sqrt(0.32)).normalize();
  const radial = new Vector3(0, 1, 0)
    .addScaledVector(axis, -axis.y)
    .normalize();
  const tangent = new Vector3().crossVectors(axis, radial);
  const point = (angle: number, height: number) =>
    radial
      .clone()
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(tangent, Math.sin(angle))
      .addScaledVector(axis, height)
      .toArray();
  const source = new Float32Array([
    ...point(Math.PI / 4, 0),
    ...point(Math.PI / 2, 0),
    ...point(Math.PI / 4, 1),
  ]);
  const operation = {
    kind: "unroll" as const,
    center: [0, 0, 0] as Vec3,
    axis: axis.toArray() as Vec3,
    radius: 1,
  };
  const result = unrollScanMesh(source, operation);
  expect(result.positions[0]).toBeCloseTo(Math.PI / 4, 5);
  expect(result.positions[3]).toBeCloseTo(Math.PI / 2, 5);
  expect(result.positions[6]).toBeCloseTo(Math.PI / 4, 5);
  const { frame } = createUnrollAuxiliaries(operation, result.positions, {
    frameId: "frame",
    sketchId: "sketch",
    sourceEntityId: "source",
    meshEntityId: "result",
  });
  frame.coordinateFrame!.frame.normal.forEach((value, index) =>
    expect(value).toBeCloseTo(radial.toArray()[index], 12),
  );
});
