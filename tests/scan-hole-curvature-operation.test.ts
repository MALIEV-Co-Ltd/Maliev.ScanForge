import { expect, it } from "vitest";
import fixture from "./fixtures/hole-fill-observed-curvature-annulus.json";
import reference from "./fixtures/curvature-grid-open-kernel.json";
import { nativeStlTopology } from "../src/scan-native-stl-topology";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { prepareCurvatureSurface } from "../src/scan-hole-curvature-operation";

function source() {
  const positions = Float32Array.from(
    fixture.source.faces.flatMap((face) =>
      face.flatMap((id) => fixture.source.vertices[id]),
    ),
  );
  const indexed = nativeStlTopology(positions);
  const topology = analyzeIndexedMesh(
    Float64Array.from(indexed.vertices),
    indexed.triangles,
  );
  const boundary = topology.boundaryLoops.find((loop) =>
    loop.every(
      (id) =>
        Math.hypot(topology.vertices[id * 3], topology.vertices[id * 3 + 1]) <
        2.01,
    ),
  )!;
  return { topology, boundary };
}
it("prepares the fixed local surface from the original indexed collar", () => {
  const { topology, boundary } = source(),
    before = topology.vertices.slice();
  const result = prepareCurvatureSurface(topology, boundary);
  expect(topology.vertices).toEqual(before);
  expect(result.matrix).toHaveLength(12);
  expect(result.patch.points).toHaveLength(529);
  expect(
    Math.max(
      ...result.patch.points.flatMap((point, i) =>
        point.map((v, a) => Math.abs(v - reference.patch.points[i][a])),
      ),
    ),
  ).toBeLessThan(1e-8);
});
it("checks cancellation before preparing a surface", () => {
  const { topology, boundary } = source();
  expect(() =>
    prepareCurvatureSurface(topology, boundary, () => {
      throw new DOMException("Cancelled", "AbortError");
    }),
  ).toThrow(/Cancelled/);
});

it("preserves the shared async driver for non-kernel hole algorithms", async () => {
  const { runScanEditAsync } = await import("../src/scan-edit");
  const { topology, boundary } = source();
  const positions = Float32Array.from(
    fixture.source.faces.flatMap((face) =>
      face.flatMap((id) => fixture.source.vertices[id]),
    ),
  );
  const inner = topology.boundaryLoops.indexOf(boundary);
  const result = await runScanEditAsync(
    {
      kind: "scanEdit",
      action: "fillHoles",
      positions,
      indices: [inner],
      algorithm: "flat",
    },
    { topologyCache: { positions, tolerance: 1e-6, topology } },
  );
  expect(result.diagnostics.filledHoles).toBe(1);
  expect(result.positions!.length / 9).toBe(
    fixture.source.faces.length + boundary.length - 2,
  );
});
