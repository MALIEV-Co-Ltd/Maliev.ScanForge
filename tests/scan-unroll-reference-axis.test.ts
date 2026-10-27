import { expect, it } from "vitest";
import { bindUnrollReference } from "../src/scan-unroll-reference";
import type { Entity, Vec3 } from "../src/types";

const source: Entity = {
  id: "source",
  name: "Source",
  kind: "mesh",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  color: "#aaaaaa",
  visible: true,
  opacity: 1,
};
const cylinder: Entity = {
  ...source,
  id: "cad",
  name: "Cylinder",
  kind: "cad",
  kernelId: "exact",
};

it.each([
  [
    [0, 0, -1],
    [0, 0, 1],
  ],
  [
    [-0.8, 0.2, 0.5],
    [0.8, -0.2, -0.5],
  ],
  [
    [0.5, -0.8, 0.2],
    [-0.5, 0.8, -0.2],
  ],
  [
    [-0.7, 0.7, 0.1],
    [0.7, -0.7, -0.1],
  ],
  [
    [0.7, -0.7, 0.1],
    [0.7, -0.7, 0.1],
  ],
  [
    [0.1, -0.7, 0.7],
    [-0.1, 0.7, -0.7],
  ],
  [
    [-0.7, 0.7, 0.7],
    [0.7, -0.7, -0.7],
  ],
  [
    [0.2, 0.5, -0.8],
    [-0.2, -0.5, 0.8],
  ],
])(
  "binds an exact CAD cylinder axis consistently for %j",
  async (input, expected) => {
    const face = {
      kind: "cylinder" as const,
      faceIndex: 0,
      firstTriangle: 0,
      triangleCount: 1,
      location: [0, 0, 0] as Vec3,
      axis: input as Vec3,
      firstV: 0,
      lastV: 1,
      radius: 2,
      semiAngle: 0,
    };
    const result = await bindUnrollReference(
      { kind: "unroll", cylinderId: cylinder.id },
      source,
      [source, cylinder],
      async () => [face],
      () => {},
    );
    result.operation.axis.forEach((value, i) =>
      expect(value).toBeCloseTo(expected[i], 14),
    );
    expect(result.reference.axis).toEqual(result.operation.axis);
    expect(face.axis).toEqual(input);
  },
);

it("preserves construction-cylinder axis direction pending native validation", async () => {
  const construction: Entity = {
    ...source,
    id: "construction",
    kind: "cylinder",
    fit: {
      kind: "cylinder",
      center: [0, 0, 0],
      axis: [0, 0, -1],
      radius: 2,
      rms: 0,
      maxError: 0,
    },
  };
  const result = await bindUnrollReference(
    { kind: "unroll", cylinderId: construction.id },
    source,
    [source, construction],
    async () => [],
    () => {},
  );
  expect(result.operation.axis).toEqual([0, 0, -1]);
});
