import { expect, it } from "vitest";
import { repolygonizeScanMesh } from "../src/scan-tools-remesh";
import { scanToolRequest } from "../src/ui/scan-tool-request";
import { bindShrinkwrap } from "../src/shrinkwrap-request";
import type { Entity } from "../src/types";

function cloud(id: string): Entity {
  return {
    id,
    name: id,
    kind: "pointcloud",
    visible: true,
    color: "#aaa",
    opacity: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1]),
  };
}

it("binds cloud XYZ records and mixed targets through the shared GUI request", () => {
  const a = cloud("a"),
    b = cloud("b");
  const triangle: Entity = {
    ...cloud("triangle"),
    kind: "mesh",
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  };
  const request = scanToolRequest(
    a,
    { kind: "repolygonize", resolution: 0.5, targetIds: ["triangle", "b"] },
    [a, b, triangle],
  );
  expect(request.operation).toMatchObject({
    kind: "repolygonize",
    inputKind: "points",
    targetInputs: [
      { kind: "triangles", positions: triangle.positions },
      { kind: "points", positions: b.positions },
    ],
  });
  expect(a.kind).toBe("pointcloud");
});

it("reconstructs a single XYZ point without requiring artificial triangle faces", () => {
  const source = new Float32Array([0, 0, 0]);
  const options = { resolution: 1, inputKind: "points" as const };
  const result = repolygonizeScanMesh(source, options);
  expect(result.positions.length).toBeGreaterThan(0);
  expect(result.topology.watertight).toBe(true);
  expect(result.diagnostics).toMatchObject({
    inputPoints: 1,
    inputTriangles: 0,
    inputPointClouds: 1,
    inputMeshes: 0,
    processedPoints: 1,
    representedPoints: 1,
    selfIntersectionsChecked: false,
  });
  expect(Array.from(source)).toEqual([0, 0, 0]);
});

it("fuses explicitly typed point and triangle records and accounts for every input", () => {
  const source = new Float32Array([0, 0, 0]);
  const options = {
    resolution: 1,
    inputKind: "points" as const,
    targetInputs: [
      {
        kind: "triangles" as const,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      },
      { kind: "points" as const, positions: new Float32Array([2, 0, 0]) },
    ],
  };
  const result = repolygonizeScanMesh(source, options);
  expect(result.topology.watertight).toBe(true);
  expect(result.diagnostics).toMatchObject({
    inputPoints: 2,
    inputTriangles: 1,
    inputPointClouds: 2,
    inputMeshes: 1,
    processedPoints: 2,
    representedPoints: 2,
  });
});

it("keeps mesh-only processing and ShrinkWrap unavailable for point clouds", () => {
  const a = cloud("a");
  expect(() =>
    scanToolRequest(a, { kind: "scaleMesh", factor: 2, center: [0, 0, 0] }, [
      a,
    ]),
  ).toThrow();
  expect(() => bindShrinkwrap(a, { kind: "shrinkwrap" }, [a])).toThrow();
});

it("keeps mixed progress monotonic and bounds cancellation before output", () => {
  const fractions: number[] = [];
  repolygonizeScanMesh(new Float32Array([0, 0, 0]), {
    resolution: 1,
    inputKind: "points",
    targetInputs: [
      {
        kind: "triangles",
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      },
    ],
    onProgress: (f) => fractions.push(f),
  });
  expect(fractions.every((f, i) => i === 0 || f >= fractions[i - 1])).toBe(
    true,
  );
  const controller = new AbortController();
  expect(() =>
    repolygonizeScanMesh(new Float32Array([0, 0, 0]), {
      inputKind: "points",
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }),
  ).toThrow(/cancel/i);
});

it("rejects invalid point records and numeric overflow before extraction", () => {
  for (const positions of [new Float32Array([0, 0]), [NaN, 0, 0], [1e40, 0, 0]])
    expect(() =>
      repolygonizeScanMesh(positions, { inputKind: "points" }),
    ).toThrow(/complete|finite/);
});
