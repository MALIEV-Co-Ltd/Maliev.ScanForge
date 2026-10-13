import { expect, it } from "vitest";
import * as THREE from "three";
import {
  installDeviationHeatmap,
  deviationExtrema,
} from "../src/deviation-heatmap";
import { createNoiseComparisonOverlay } from "../src/noise-comparison-overlay";

it("changes shader tolerance uniforms without replacing measured samples or geometry", () => {
  const mesh = createNoiseComparisonOverlay(
    [0, 0, 0, 1, 0, 0, 0, 1, 0],
    new Uint8Array(9),
  );
  const distances = new Float32Array([-0.03, 0.02, NaN]);
  const update = installDeviationHeatmap(mesh, {
    distances,
    lower: -0.05,
    upper: 0.05,
  });
  const attribute = mesh.geometry.getAttribute("deviationSample");
  expect(Array.from(attribute.array)).toEqual([
    distances[0],
    1,
    distances[1],
    1,
    0,
    0,
  ]);
  const shader = {
    uniforms: {} as Record<string, { value: number }>,
    vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader: "#include <common>\n#include <color_fragment>",
  };
  mesh.material.onBeforeCompile(shader as any, {} as any);
  update({ lower: -0.01, upper: 0.005 });
  expect(shader.uniforms.deviationLower.value).toBe(-0.01);
  expect(shader.uniforms.deviationUpper.value).toBe(0.005);
  expect(shader.fragmentShader).toContain("d / limit");
  expect(mesh.geometry.getAttribute("deviationSample")).toBe(attribute);
  expect(Number.isNaN(distances[2])).toBe(true);
  mesh.geometry.dispose();
  mesh.material.dispose();
});

it("anchors extrema to original sample coordinates and excludes unmatched and hidden facets", () => {
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 1, 0, 2, 0, 1, 2];
  const points = deviationExtrema(
    positions,
    [NaN, -0.02, 0.03, -0.1, 0.2, 0],
    [1],
  );
  expect(points.map((p) => [p.label, p.value, p.point.toArray()])).toEqual([
    ["Minimum", -0.02, [1, 0, 0]],
    ["Maximum", 0.03, [0, 1, 0]],
  ]);
  expect(deviationExtrema(positions, [NaN, NaN, NaN])).toEqual([]);
});
