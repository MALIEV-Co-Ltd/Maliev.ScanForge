import { expect, it } from "vitest";
import { lassoTrianglePoint, pointInLasso } from "../src/lasso-coverage";
import { ScreenSelectionIndex } from "../src/screen-selection";
import * as THREE from "three";

it("closes an open arc with a straight segment and fills its interior", () => {
  const path: [number, number][] = [
    [20, 20],
    [0, 40],
    [0, 80],
    [20, 100],
    [60, 100],
  ];
  expect(pointInLasso([20, 60], path)).toBe(true);
  expect(pointInLasso([70, 50], path)).toBe(false);
  expect(
    lassoTrianglePoint(
      [
        [18, 58],
        [22, 58],
        [20, 62],
      ],
      path,
      1,
    ),
  ).not.toBeNull();
  expect(
    lassoTrianglePoint(
      [
        [80, 20],
        [90, 20],
        [85, 30],
      ],
      path,
      1,
    ),
  ).toBeNull();
});
it("fills the center of a circular loop in either winding", () => {
  const path: [number, number][] = Array.from({ length: 32 }, (_, i) => [
    100 + Math.cos((i * Math.PI) / 16) * 50,
    100 + Math.sin((i * Math.PI) / 16) * 50,
  ]);
  const triangle: [number, number][] = [
    [98, 98],
    [102, 98],
    [100, 102],
  ];
  expect(lassoTrianglePoint(triangle, path, 1)).not.toBeNull();
  expect(
    lassoTrianglePoint(triangle, path.slice().reverse(), 1),
  ).not.toBeNull();
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.z = 10;
  camera.lookAt(0, 0, 0);
  const index = new ScreenSelectionIndex(
    new Float32Array([
      -0.1, -0.1, 0, 0.1, -0.1, 0, 0, 0.1, 0, -0.1, -0.1, -1, 0.1, -0.1, -1, 0,
      0.1, -1,
    ]),
  );
  try {
    expect([
      ...index.select(
        camera,
        { kind: "lasso", points: path, radius: 1 },
        { width: 200, height: 200, through: false },
      ),
    ]).toEqual([1, 0]);
    expect([
      ...index.select(
        camera,
        { kind: "lasso", points: path, radius: 1 },
        { width: 200, height: 200, through: true },
      ),
    ]).toEqual([1, 1]);
  } finally {
    index.dispose();
  }
});
