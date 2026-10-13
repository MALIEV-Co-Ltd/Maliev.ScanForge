import { expect, it } from "vitest";
import * as THREE from "three";
import {
  installDeviationHeatmap,
  deviationExtrema,
  projectedModelBounds,
  placeDeviationLabel,
  meshFootprint,
  type ScreenRect,
} from "../src/deviation-heatmap";
import { createNoiseComparisonOverlay } from "../src/noise-comparison-overlay";

it("keeps both labels outside model bounds through camera rotations and zoom", () => {
  const box = new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, 1, 1),
  );
  const camera = new THREE.PerspectiveCamera(45, 1.6, 0.1, 100);
  for (let angle = 0; angle < Math.PI * 2; angle += 0.15) {
    camera.position.set(8 * Math.cos(angle), 4, 8 * Math.sin(angle));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const bounds = projectedModelBounds(box, camera, 960, 600);
    const occupied: ScreenRect[] = [];
    for (const anchor of [
      { x: 480, y: 300 },
      { x: 490, y: 310 },
    ]) {
      const rect = placeDeviationLabel(
        bounds,
        anchor,
        150,
        26,
        960,
        600,
        occupied,
      )!;
      expect(rect).toBeDefined();
      expect(
        rect.x + rect.width <= bounds.x ||
          rect.x >= bounds.x + bounds.width ||
          rect.y + rect.height <= bounds.y ||
          rect.y >= bounds.y + bounds.height,
      ).toBe(true);
      expect(
        occupied.every(
          (o) =>
            rect.x + rect.width <= o.x ||
            rect.x >= o.x + o.width ||
            rect.y + rect.height <= o.y ||
            rect.y >= o.y + o.height,
        ),
      ).toBe(true);
      occupied.push(rect);
    }
  }
  expect(
    placeDeviationLabel(
      { x: 0, y: 0, width: 960, height: 600 },
      { x: 480, y: 300 },
      150,
      26,
      960,
      600,
    ),
  ).toBeUndefined();
});

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

it("uses nearby clear space in concave silhouettes instead of the overall bounding box", () => {
  const shape = [
    { x: 300, y: 180, width: 80, height: 400 },
    { x: 620, y: 180, width: 80, height: 400 },
    { x: 300, y: 180, width: 400, height: 60 },
  ];
  const anchor = { x: 380, y: 390 };
  const label = placeDeviationLabel(shape, anchor, 130, 26, 1000, 700)!;
  expect(label).toBeDefined();
  expect(label.x).toBeGreaterThan(390);
  expect(label.x + label.width).toBeLessThan(620);
  expect(Math.hypot(label.x - anchor.x, label.y - anchor.y)).toBeLessThan(80);
});
it("avoids tool panels, the scale legend, and the other label near either point", () => {
  const model = { x: 380, y: 220, width: 200, height: 200 };
  const panel = { x: 0, y: 0, width: 360, height: 600 };
  const legend = { x: 850, y: 0, width: 150, height: 700 };
  const occupied = [panel, legend];
  for (const anchor of [
    { x: 390, y: 240 },
    { x: 390, y: 250 },
  ]) {
    const label = placeDeviationLabel(
      model,
      anchor,
      130,
      26,
      1000,
      700,
      occupied,
    )!;
    expect(label).toBeDefined();
    for (const obstacle of [model, ...occupied])
      expect(
        label.x + label.width <= obstacle.x ||
          label.x >= obstacle.x + obstacle.width ||
          label.y + label.height <= obstacle.y ||
          label.y >= obstacle.y + obstacle.height,
      ).toBe(true);
    expect(
      Math.hypot(
        label.x + label.width / 2 - anchor.x,
        label.y + label.height / 2 - anchor.y,
      ),
    ).toBeLessThan(200);
    occupied.push(label);
  }
});
it("covers complete triangles with bounded cells without filling a concave model's empty space", () => {
  const positions = [-5, 0, 0, -4, 1, 0, -4, 0, 0, 4, 0, 0, 5, 1, 0, 5, 0, 0];
  const footprint = meshFootprint(positions);
  expect(footprint).toHaveLength(2);
  for (let i = 0; i < positions.length; i += 3)
    expect(
      footprint.some((box) =>
        box.containsPoint(
          new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]),
        ),
      ),
    ).toBe(true);
  expect(
    footprint.some((box) => box.containsPoint(new THREE.Vector3(0, 0, 0))),
  ).toBe(false);
});
