import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import {
  ScreenSelectionIndex,
  type ScreenRegion,
} from "../src/screen-selection";

function stroke(
  tool: "brush" | "freehand" | "line",
  points: [number, number][],
) {
  const view = Object.create(Viewport.prototype) as any;
  const attributes = new Map<string, string>();
  Object.assign(view, {
    selectionTool: tool,
    brushPixels: 2,
    brushPath: points.slice(),
    paintOverlay: { style: {} },
    paintCursor: { setAttribute: vi.fn() },
    paintTrail: {
      setAttribute: (key: string, value: string) => attributes.set(key, value),
    },
    screenPoint: (x: number, y: number) => [x, y],
    applyScreenRegion: vi.fn(),
  });
  const end = points.at(-1)!;
  view.paintScreen({ clientX: end[0], clientY: end[1] }, true);
  return {
    region: view.applyScreenRegion.mock.calls[0][1] as ScreenRegion,
    attributes,
  };
}
it("freehand selects only the stroke and leaves the loop interior unfilled", () => {
  const points: [number, number][] = [
    [50, 50],
    [150, 50],
    [150, 150],
    [50, 150],
    [50, 50],
  ];
  const filled = stroke("brush", points),
    unfilled = stroke("freehand", points);
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.z = 10;
  camera.lookAt(0, 0, 0);
  const index = new ScreenSelectionIndex(
    new Float32Array([-0.1, -0.1, 0, 0.1, -0.1, 0, 0, 0.1, 0]),
  );
  try {
    const options = { width: 200, height: 200, through: false };
    expect([...index.select(camera, filled.region, options)]).toEqual([1]);
    expect([...index.select(camera, unfilled.region, options)]).toEqual([0]);
    expect(unfilled.attributes.get("fill")).toBe("none");
    expect(unfilled.attributes.get("d")).not.toContain("Z");
  } finally {
    index.dispose();
  }
});
it("straight line ignores detours both in visual preview and selection coverage", () => {
  const { region, attributes } = stroke("line", [
    [20, 100],
    [100, 20],
    [180, 100],
  ]);
  expect(region).toEqual({
    kind: "brush",
    points: [
      [20, 100],
      [180, 100],
    ],
    radius: 2,
  });
  expect(attributes.get("d")).toBe("M20,100 L180,100");
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.z = 10;
  camera.lookAt(0, 0, 0);
  const index = new ScreenSelectionIndex(
    new Float32Array([
      -0.1, -0.1, 0, 0.1, -0.1, 0, 0, 0.1, 0, -0.1, 3.9, 0, 0.1, 3.9, 0, 0, 4.1,
      0,
    ]),
  );
  try {
    expect([
      ...index.select(camera, region, {
        width: 200,
        height: 200,
        through: true,
      }),
    ]).toEqual([1, 0]);
  } finally {
    index.dispose();
  }
});
