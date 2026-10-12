import { expect, it } from "vitest";
import { BoxGeometry } from "three";
import { parseProject } from "../src/io";
import type { Entity } from "../src/types";
import {
  mirrorReference,
  cylinderReference,
} from "../src/scan-tools-reference";
import { scanToolRequest } from "../src/ui/scan-tool-request";
const source: Entity = {
  id: "scan",
  name: "Scan",
  kind: "mesh",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  color: "#aaaaaa",
  visible: true,
  opacity: 1,
};
it("binds origin planes with the correct world normal", () => {
  for (const [plane, normal] of [
    ["OXY", [0, 0, 1]],
    ["OYZ", [1, 0, 0]],
    ["OXZ", [0, 1, 0]],
  ] as const) {
    const request = scanToolRequest(source, { kind: "mirrorMesh", plane }, [
      source,
    ]);
    expect(request.operation).toEqual({
      kind: "mirrorMesh",
      center: [0, 0, 0],
      normal,
    });
  }
});
it("accepts planar CAD and rejects curved or volumetric objects as a mirror plane", () => {
  const plane: Entity = {
    ...source,
    id: "plane",
    kind: "cad",
    kernelId: "exact",
  };
  expect(mirrorReference(plane)?.normal.map(Math.abs)).toEqual([0, 0, 1]);
  const indexed = new BoxGeometry(),
    geometry = indexed.toNonIndexed();
  expect(
    mirrorReference({
      ...plane,
      positions: new Float32Array(geometry.getAttribute("position").array),
    }),
  ).toBeNull();
  geometry.dispose();
  indexed.dispose();
  expect(
    scanToolRequest(
      source,
      { kind: "mirrorMesh", plane: "object", referenceId: plane.id },
      [source, plane],
    ).operation.kind,
  ).toBe("mirrorMesh");
});
it("uses fitted cylinders and refuses missing references", () => {
  const cylinder: Entity = {
    ...source,
    id: "cylinder",
    kind: "cylinder",
    fit: {
      kind: "cylinder",
      center: [1, 2, 3],
      axis: [0, 0, 1],
      radius: 4,
      rms: 0,
      maxError: 0,
    },
  };
  expect(cylinderReference(cylinder)?.radius).toBe(4);
  expect(
    scanToolRequest(
      source,
      { kind: "unroll", cylinderId: cylinder.id, offsetDegrees: 20 },
      [source, cylinder],
    ).operation,
  ).toMatchObject({ radius: 4, offsetDegrees: 20, center: [1, 2, 3] });
  expect(() =>
    scanToolRequest(
      source,
      { kind: "unroll", cylinderId: "missing", offsetDegrees: 0 },
      [source],
    ),
  ).toThrow("cylinder");
});
it("restores a cylindrical construction reference when project loading omits transient fits", () => {
  const positions: number[] = [];
  for (let i = 0; i < 16; i++)
    for (const z of [-2, 2])
      positions.push(
        5 * Math.cos((i * Math.PI) / 8),
        5 * Math.sin((i * Math.PI) / 8),
        z,
      );
  const restored = cylinderReference({
    ...source,
    kind: "cylinder",
    positions,
  });
  expect(restored?.radius).toBeCloseTo(5, 6);
  expect(Math.abs(restored?.axis[2] ?? 0)).toBeCloseTo(1);
  expect(cylinderReference({ ...source, kind: "cad" })).toBeNull();
});
it("recovers a triangulated cylindrical reference after reopening a project", () => {
  const positions: number[] = [];
  const p = (a: number, z: number) => [
    20 + 5 * Math.cos(a),
    5 * Math.sin(a),
    z,
  ];
  for (let i = 0; i < 32; i++) {
    const a = (i * Math.PI) / 16,
      b = ((i + 1) * Math.PI) / 16;
    positions.push(
      ...p(a, 0),
      ...p(b, 0),
      ...p(b, 5),
      ...p(a, 0),
      ...p(b, 5),
      ...p(a, 5),
    );
  }
  const project = parseProject(
    JSON.stringify({
      format: "maliev-scanforge",
      version: 1,
      name: "Reference",
      units: "mm",
      entities: [{ ...source, kind: "cylinder", positions }],
    }),
  );
  expect(cylinderReference(project.entities[0])?.radius).toBeCloseTo(5, 5);
});
it("protects CAD sources and rejects stale selection and average references", () => {
  expect(() =>
    scanToolRequest({ ...source, kernelId: "exact" }, { kind: "flipNormals" }, [
      source,
    ]),
  ).toThrow("mesh copy");
  expect(() =>
    scanToolRequest(
      source,
      { kind: "averageMesh", targetIds: [source.id], tolerance: 10 },
      [source],
    ),
  ).toThrow("reference meshes");
  expect(() =>
    scanToolRequest(
      source,
      {
        kind: "reduceNoise",
        iterations: 3,
        deviation: 0.05,
        selectionOnly: true,
      },
      [source],
      new Uint8Array(2),
    ),
  ).toThrow("Select triangles");
});
