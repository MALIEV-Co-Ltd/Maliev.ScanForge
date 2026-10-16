import { expect, it } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import { weldScanSamples } from "../src/scan-resident-samples";
import { ScanPreviewSession } from "../src/scan-preview";

it("retains exactly the recovered representatives and corners without adjacency", () => {
  const p: number[] = [];
  for (let i = 0; i < 90; i++) {
    const x = -0.123456789 + i * 0.75e-6;
    p.push(x, -1e-6, 0, x, 1, 0, x + 2e-6, 0, 1);
  }
  const reference = analyzeMesh(p, { tolerance: 1e-6 }),
    actual = weldScanSamples(p);
  expect(actual.vertices).toEqual(reference.vertices);
  expect(actual.triangles).toEqual(reference.triangles);
  expect(Object.keys(actual).sort()).toEqual(["triangles", "vertices"]);
});

it("does not build original adjacency merely to create a polygon comparison preview", async () => {
  const stages: string[] = [];
  await ScanPreviewSession.create(
    {
      kind: "scanPreview",
      phase: "create",
      previewId: "samples",
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      operation: {
        kind: "reducePolygons",
        mode: "percentage",
        percentage: 100,
      },
    },
    { onProgress: (_, stage) => stages.push(stage) },
  );
  expect(stages.some((stage) => stage.includes("Building topology"))).toBe(
    false,
  );
});

it.each(
  [-1, 0, 1].flatMap((x) =>
    [-1, 0, 1].flatMap((y) => [-1, 0, 1].map((z) => [x, y, z])),
  ),
)(
  "preserves representative order through neighbor cell %s %s %s",
  (x, y, z) => {
    const origin = [0.123456789, -0.987654321, 0.333333333];
    const second = origin.map(
      (value, axis) => value + [x, y, z][axis] * 0.9e-6,
    );
    const query = origin.map(
      (value, axis) => value + [x, y, z][axis] * 0.45e-6,
    );
    const points = [...origin, ...second, ...query];
    const expected = analyzeMesh(points, { tolerance: 1e-6 }),
      actual = weldScanSamples(points);
    expect(actual.vertices).toEqual(expected.vertices);
    expect(actual.triangles).toEqual(expected.triangles);
  },
);
