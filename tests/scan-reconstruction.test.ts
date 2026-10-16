import { BoxGeometry } from "three";
import { expect, it } from "vitest";
import { repolygonizeScanMesh } from "../src/scan-tools-remesh";
import { reconstructionTargets } from "../src/scan-reconstruction-targets";
import { scanToolRequest } from "../src/ui/scan-tool-request";
import type { Entity } from "../src/types";
function mesh(id: string, offset = 0): Entity {
  const indexed = new BoxGeometry(2, 2, 2),
    geometry = indexed.toNonIndexed();
  const positions = Float32Array.from(geometry.getAttribute("position").array);
  for (let i = 0; i < positions.length; i += 3) positions[i] += offset;
  indexed.dispose();
  geometry.dispose();
  return {
    id,
    name: id,
    kind: "mesh",
    positions,
    color: "#aaa",
    visible: true,
    opacity: 1,
  };
}
it("binds additional reconstruction meshes from workspace IDs and rejects invalid references", () => {
  const a = mesh("a"),
    b = mesh("b", 1);
  const request = scanToolRequest(
    a,
    { kind: "repolygonize", resolution: 0.5, targetIds: ["b"] },
    [a, b],
  );
  expect(request.operation).toEqual({
    kind: "repolygonize",
    resolution: 0.5,
    targets: [b.positions],
  });
  for (const targetIds of [["a"], ["missing"], ["b", "b"]])
    expect(() =>
      scanToolRequest(a, { kind: "repolygonize", resolution: 0.5, targetIds }, [
        a,
        b,
      ]),
    ).toThrow(/reconstruction/i);
  expect(() =>
    scanToolRequest(
      a,
      { kind: "repolygonize", resolution: 0.5, targetIds: ["b"] },
      [a, { ...b, kernelId: "exact" }],
    ),
  ).toThrow(/reconstruction/i);
});
it("fuses multiple inputs and exposes measured closure without mutating inputs", () => {
  const a = mesh("a"),
    b = mesh("b", 1),
    before = Array.from(b.positions);
  const result = repolygonizeScanMesh(a.positions, {
    resolution: 0.5,
    targets: [b.positions],
  });
  expect(result.diagnostics.watertight).toBe(true);
  expect(result.diagnostics.inputMeshes).toBe(2);
  expect(result.topology.components).toBe(1);
  expect(result.topology.boundaryEdges).toBe(0);
  expect(result.topology.nonManifoldVertices).toBe(0);
  expect(Array.from(b.positions)).toEqual(before);
});
it("reports separated closed components truthfully", () => {
  const result = repolygonizeScanMesh(mesh("a").positions, {
    resolution: 0.5,
    targets: [mesh("b", 8).positions],
  });
  expect(result.diagnostics.watertight).toBe(true);
  expect(result.topology.components).toBe(2);
  expect(result.summary).toContain("2 closed components");
  expect(result.diagnostics.selfIntersectionsChecked).toBe(false);
});
it("validates every reconstruction input before sampling and respects cancellation during verification", () => {
  expect(() =>
    repolygonizeScanMesh(mesh("a").positions, {
      targets: [[NaN, 0, 0, 1, 0, 0, 0, 1, 0]],
    }),
  ).toThrow(/finite/);
  expect(() =>
    repolygonizeScanMesh(mesh("a").positions, { targets: [[1, 2, 3]] }),
  ).toThrow(/triangles/);
  const controller = new AbortController();
  expect(() =>
    repolygonizeScanMesh(mesh("a").positions, {
      signal: controller.signal,
      onProgress: (_f, stage) => {
        if (stage === "Verifying reconstructed topology") controller.abort();
      },
    }),
  ).toThrow(/cancelled/);
});

it("rejects an oversized aggregate before allocating target copies", () => {
  const positions = new Float32Array(13_500_009);
  const source = { ...mesh("a"), positions };
  const target = { ...mesh("b"), positions };
  expect(() => reconstructionTargets(source, [target])).toThrow(
    /combined.*limit/i,
  );
});
