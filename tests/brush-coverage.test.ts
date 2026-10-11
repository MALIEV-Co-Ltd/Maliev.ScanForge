import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { brushTrianglePoint } from "../src/brush-coverage";
import { ScreenSelectionIndex } from "../src/screen-selection";

describe("continuous mesh painting", () => {
  it("covers a stroke between sparse events and curved intermediate points", () => {
    expect(
      brushTrianglePoint(
        [
          [49, 49],
          [51, 49],
          [50, 51],
        ],
        [
          [0, 50],
          [100, 50],
        ],
        1,
      ),
    ).not.toBeNull();
    expect(
      brushTrianglePoint(
        [
          [49, 49],
          [51, 49],
          [50, 51],
        ],
        [
          [0, 0],
          [50, 50],
          [100, 0],
        ],
        1,
      ),
    ).not.toBeNull();
    expect(
      brushTrianglePoint(
        [
          [49, 49],
          [51, 49],
          [50, 51],
        ],
        [
          [0, 0],
          [100, 0],
        ],
        1,
      ),
    ).toBeNull();
  });
  it("selects a large triangle touched at an edge even when its centroid is outside the brush", () => {
    expect(
      brushTrianglePoint(
        [
          [0, 0],
          [100, 0],
          [0, 100],
        ],
        [[50, -1]],
        2,
      ),
    ).toEqual([50, 0]);
    expect(
      brushTrianglePoint(
        [
          [0, 0],
          [100, 0],
          [0, 100],
        ],
        [[50, -3]],
        2,
      ),
    ).toBeNull();
  });
  const camera = new THREE.OrthographicCamera(0, 200, 200, 0, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  it("does not leave holes across twenty triangles during a single fast drag", () => {
    const positions = Array.from({ length: 20 }, (_, i) => [
      i * 9 + 10,
      99,
      0,
      i * 9 + 14,
      99,
      0,
      i * 9 + 12,
      101,
      0,
    ]).flat();
    const index = new ScreenSelectionIndex(positions);
    try {
      const mask = index.select(
        camera,
        {
          kind: "brush",
          points: [
            [0, 100],
            [200, 100],
          ],
          radius: 1,
        },
        { width: 200, height: 200, through: false },
      );
      expect([...mask]).toEqual(Array(20).fill(1));
    } finally {
      index.dispose();
    }
  });
  it("preserves occlusion, through selection, hidden slots and source geometry", () => {
    const face = [10, 99, 0, 20, 99, 0, 15, 101, 0];
    const positions = new Float32Array([
      ...face,
      ...face.map((v, i) => (i % 3 === 2 ? -1 : v)),
    ]);
    const original = [...positions];
    const index = new ScreenSelectionIndex(positions);
    const region = {
      kind: "brush" as const,
      points: [
        [0, 100],
        [30, 100],
      ] as [number, number][],
      radius: 1,
    };
    try {
      expect([
        ...index.select(camera, region, {
          width: 200,
          height: 200,
          through: false,
        }),
      ]).toEqual([1, 0]);
      expect([
        ...index.select(camera, region, {
          width: 200,
          height: 200,
          through: true,
        }),
      ]).toEqual([1, 1]);
      expect([...positions]).toEqual(original);
    } finally {
      index.dispose();
    }
    const hidden = new ScreenSelectionIndex(positions, [0]);
    try {
      expect([
        ...hidden.select(camera, region, {
          width: 200,
          height: 200,
          through: false,
        }),
      ]).toEqual([0, 1]);
    } finally {
      hidden.dispose();
    }
  });
});
