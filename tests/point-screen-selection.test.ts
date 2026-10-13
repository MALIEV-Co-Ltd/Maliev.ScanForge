import { expect, it } from "vitest";
import * as THREE from "three";
import { PointScreenSelectionIndex } from "../src/point-screen-selection";

function camera() {
  const c = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  c.position.set(0, 0, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}
const rectangle = {
  kind: "rectangle" as const,
  start: [0, 0] as [number, number],
  end: [100, 100] as [number, number],
};
const view = { width: 100, height: 100, through: true };
it("returns one slot per XYZ point, excludes hidden and clipped points", () => {
  const index = new PointScreenSelectionIndex(
    [0, 0, 0, 1, 1, 0, -1, 0, 0, 0, 2, 0],
    [1],
  );
  expect([
    ...index.select(camera(), rectangle, {
      ...view,
      clippingPlanes: [[1, 0, 0, 0]],
    }),
  ]).toEqual([1, 0, 0, 1]);
  expect([
    ...index.select(camera(), rectangle, view, { start: 2, end: 4 }),
  ]).toEqual([1, 1]);
});
it("distinguishes visible samples from see-through depth overlap", () => {
  const index = new PointScreenSelectionIndex([0, 0, 0, 0, 0, -2, 2, 0, 0]);
  expect([
    ...index.select(camera(), rectangle, { ...view, through: false }),
  ]).toEqual([1, 0, 1]);
  expect([...index.select(camera(), rectangle, view)]).toEqual([1, 1, 1]);
});
it("supports filled lasso, continuous line brush, and circle footprints", () => {
  const index = new PointScreenSelectionIndex([0, 0, 0, 3, 3, 0, -3, 0, 0]);
  expect([
    ...index.select(
      camera(),
      {
        kind: "lasso",
        points: [
          [40, 40],
          [60, 40],
          [60, 60],
          [40, 60],
        ],
        radius: 1,
      },
      view,
    ),
  ]).toEqual([1, 0, 0]);
  expect([
    ...index.select(
      camera(),
      {
        kind: "brush",
        points: [
          [10, 50],
          [60, 50],
        ],
        radius: 1,
      },
      view,
    ),
  ]).toEqual([1, 0, 1]);
  expect([
    ...index.select(
      camera(),
      { kind: "circle", start: [40, 40], end: [60, 60] },
      view,
    ),
  ]).toEqual([1, 0, 0]);
});
it("rejects malformed clouds, partitions and regions", () => {
  expect(() => new PointScreenSelectionIndex([0, 0])).toThrow();
  const index = new PointScreenSelectionIndex([0, 0, 0]);
  expect(() =>
    index.select(camera(), rectangle, view, { start: 0, end: 2 }),
  ).toThrow();
  expect(() =>
    index.select(camera(), { kind: "brush", points: [], radius: 1 }, view),
  ).toThrow();
});
