import { expect, it } from "vitest";
import {
  meshPointCloud,
  POINT_CLOUD_MESH_MAX_POINTS,
} from "../src/point-cloud-meshing";

it("triangulates a single surface without moving its samples", () => {
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0.2, 1, 1, 0.3, 0, 1, 0.1,
  ]);
  const before = positions.slice();
  const result = meshPointCloud({
    kind: "pointCloudMesh",
    positions,
    plane: "xy",
    maxEdgeLength: 2,
  });
  expect(result.positions.length).toBe(18);
  expect(result.diagnostics.triangles).toBe(2);
  expect(positions).toEqual(before);
  for (let i = 0; i < result.positions.length; i += 3)
    expect(Array.from(positions).join(",")).toContain(
      Array.from(result.positions.slice(i, i + 3)).join(","),
    );
});

it("prunes by full 3D edge length and fails when no triangle remains", () => {
  const positions = [0, 0, 0, 1, 0, 10, 0, 1, 0];
  expect(() =>
    meshPointCloud({
      kind: "pointCloudMesh",
      positions,
      plane: "xy",
      maxEdgeLength: 2,
    }),
  ).toThrow(/no triangle/i);
  expect(
    meshPointCloud({
      kind: "pointCloudMesh",
      positions,
      plane: "xy",
      maxEdgeLength: 0,
    }).positions.length,
  ).toBe(9);
});

it("supports each explicit projection and rejects degenerate and multi-valued clouds", () => {
  for (const plane of ["xy", "xz", "yz"] as const) {
    const positions =
      plane === "xy"
        ? [0, 0, 0, 1, 0, 0, 0, 1, 0]
        : plane === "xz"
          ? [0, 0, 0, 1, 0, 0, 0, 0, 1]
          : [0, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(
      meshPointCloud({
        kind: "pointCloudMesh",
        positions,
        plane,
        maxEdgeLength: 0,
      }).positions.length,
    ).toBe(9);
  }
  expect(() =>
    meshPointCloud({
      kind: "pointCloudMesh",
      positions: [0, 0, 0, 1, 0, 0, 2, 0, 0],
      plane: "xy",
    }),
  ).toThrow(/collinear|degenerate/i);
  expect(() =>
    meshPointCloud({
      kind: "pointCloudMesh",
      positions: [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0],
      plane: "xy",
    }),
  ).toThrow(/multiple heights/i);
  expect(() =>
    meshPointCloud({
      kind: "pointCloudMesh",
      positions: [0, 0, 0, 1, 0, 0, 0, 1, NaN],
      plane: "xy",
    }),
  ).toThrow(/finite/i);
});

it("bounds input work and deduplicates only identical XYZ samples", () => {
  expect(() =>
    meshPointCloud({
      kind: "pointCloudMesh",
      positions: new Float32Array((POINT_CLOUD_MESH_MAX_POINTS + 1) * 3),
      plane: "xy",
    }),
  ).toThrow(/reduce the cloud/i);
  const result = meshPointCloud({
    kind: "pointCloudMesh",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
    plane: "xy",
  });
  expect(result.diagnostics.duplicatePoints).toBe(1);
  expect(result.diagnostics.triangles).toBe(1);
});
