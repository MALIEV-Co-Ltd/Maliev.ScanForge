import { expect, it } from "vitest";
import {
  compareNoiseSurface,
  compareNoiseSurfaceAsync,
} from "../src/scan-noise-deviation";
import { analyzeMesh } from "../src/mesh-processing";
import { ScanPreviewSession } from "../src/scan-preview";

it("compares a wide noise surface even when native octree subdivision exceeds its budget", async () => {
  const positions = new Float32Array([0, 0, 0, 600, 0, 0, 0, 600, 0]);
  const original = {
    ...analyzeMesh(positions),
    triangles: Uint32Array.from({ length: 96 }, (_, id) => id % 3),
  };
  for (const compare of [compareNoiseSurface, compareNoiseSurfaceAsync]) {
    const result = await compare(original, original.vertices, 0.05);
    expect(result.matched).toBe(3);
    expect(result.within).toBe(3);
    expect(Array.from(result.distances)).toEqual([0, 0, 0]);
  }
  const preview = await ScanPreviewSession.create({
    kind: "scanPreview",
    phase: "create",
    previewId: "wide-noise",
    positions,
    operation: {
      kind: "reduceNoise",
      iterations: 1,
      applyBoundaryEdges: false,
    },
  });
  const compared = preview.compare(0.05);
  expect(compared.summary).toContain("100.00% (3/3)");
  expect(compared.noiseComparison.rgb.length).toBe(9);
}, 60000);
