import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ScreenSelectionIndex } from "../src/screen-selection";

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const front = [-1, -1, 0, 1, -1, 0, 0, 1, 0],
  back = [-1, -1, -1, 1, -1, -1, 0, 1, -1];
const full = {
  kind: "rectangle" as const,
  start: [0, 0] as [number, number],
  end: [200, 200] as [number, number],
};
describe("screen-space mesh selection", () => {
  it("retains large-coordinate binary64 triangles for visibility and clipping", () => {
    const x = 100000000;
    const front = [x, 0, 0, x + 4, 0, 0, x + 4, 4, 0];
    const back = [x, 0, -1, x + 4, 0, -1, x + 4, 4, -1];
    const viewCamera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
    viewCamera.position.set(x + 2, 2, 10);
    viewCamera.lookAt(x + 2, 2, 0);
    viewCamera.updateMatrixWorld();
    viewCamera.updateProjectionMatrix();
    const index = new ScreenSelectionIndex([...front, ...back]);
    try {
      const view = { width: 200, height: 200, through: false };
      expect([...index.select(viewCamera, full, view)]).toEqual([1, 0]);
      expect([
        ...index.select(viewCamera, full, { ...view, through: true }),
      ]).toEqual([1, 1]);
      expect([
        ...index.select(viewCamera, full, {
          ...view,
          clippingPlanes: [[0, 0, -1, -0.5]],
        }),
      ]).toEqual([0, 1]);
      const brush = {
        kind: "brush" as const,
        points: [[116.67, 116.67]] as [number, number][],
        radius: 4,
      };
      expect([...index.select(viewCamera, brush, view)]).toEqual([1, 0]);
      expect([
        ...index.select(viewCamera, full, view, { start: 0, end: 1 }),
      ]).toEqual([1]);
      expect([
        ...index.select(viewCamera, full, view, { start: 1, end: 2 }),
      ]).toEqual([0]);
    } finally {
      index.dispose();
    }
  });
  it("partitioned visibility retains occlusion from triangles in other partitions", () => {
    const index = new ScreenSelectionIndex(
      new Float32Array([...front, ...back]),
    );
    try {
      for (const through of [true, false]) {
        const view = { width: 200, height: 200, through };
        const whole = index.select(camera, full, view);
        const merged = new Uint8Array(2);
        merged.set(index.select(camera, full, view, { start: 0, end: 1 }), 0);
        merged.set(index.select(camera, full, view, { start: 1, end: 2 }), 1);
        expect(merged).toEqual(whole);
        expect(Array.from(merged)).toEqual(through ? [1, 1] : [1, 0]);
      }
    } finally {
      index.dispose();
    }
  });
  it("selects the revealed rear surface after front clipping and respects all box planes", () => {
    const index = new ScreenSelectionIndex(
      new Float32Array([...front, ...back]),
    );
    try {
      const view = {
        width: 200,
        height: 200,
        through: false,
        clippingPlanes: [
          [0, 0, -1, -0.5],
          [1, 0, 0, 2],
          [-1, 0, 0, 2],
        ] as [number, number, number, number][],
      };
      expect([...index.select(camera, full, view)]).toEqual([0, 1]);
      expect([
        ...index.select(camera, full, {
          ...view,
          clippingPlanes: [...view.clippingPlanes, [0, 0, 1, 0.5]],
        }),
      ]).toEqual([0, 0]);
      expect([
        ...index.select(camera, full, { ...view, through: true }),
      ]).toEqual([0, 1]);
    } finally {
      index.dispose();
    }
  });
  it("returns an empty selection when every triangle is hidden", () => {
    const index = new ScreenSelectionIndex([...front, ...back], [0, 1]);
    try {
      expect([
        ...index.select(camera, full, {
          width: 200,
          height: 200,
          through: false,
        }),
      ]).toEqual([0, 0]);
    } finally {
      index.dispose();
    }
  });
  it("hidden front triangles neither select nor occlude revealed back triangles", () => {
    const data = new Float32Array([...front, ...back]);
    const index = new ScreenSelectionIndex(data, [0]);
    try {
      expect([
        ...index.select(camera, full, {
          width: 200,
          height: 200,
          through: false,
        }),
      ]).toEqual([0, 1]);
      expect([
        ...index.select(camera, full, {
          width: 200,
          height: 200,
          through: true,
        }),
      ]).toEqual([0, 1]);
    } finally {
      index.dispose();
    }
  });
  it("excludes occluded layers by default and includes them explicitly through the mesh", () => {
    const data = new Float32Array([...front, ...back]);
    const original = Array.from(data);
    const index = new ScreenSelectionIndex(data);
    try {
      expect(
        Array.from(
          index.select(camera, full, {
            width: 200,
            height: 200,
            through: false,
          }),
        ),
      ).toEqual([1, 0]);
      expect(
        Array.from(
          index.select(camera, full, {
            width: 200,
            height: 200,
            through: true,
          }),
        ),
      ).toEqual([1, 1]);
      expect(Array.from(data)).toEqual(original);
    } finally {
      index.dispose();
    }
  });
  it("retains original triangle slots across BVH construction, rectangle direction and winding", () => {
    const right = [2, -1, 0, 4, -1, 0, 3, 1, 0];
    const index = new ScreenSelectionIndex([...right, ...back, ...front]);
    try {
      const region = {
        kind: "rectangle" as const,
        start: [125, 200] as [number, number],
        end: [0, 0] as [number, number],
      };
      expect(
        Array.from(
          index.select(camera, region, {
            width: 200,
            height: 200,
            through: false,
          }),
        ),
      ).toEqual([0, 0, 1]);
      const flipped = new ScreenSelectionIndex([0, 1, 0, 1, -1, 0, -1, -1, 0]);
      try {
        expect(
          Array.from(
            flipped.select(camera, full, {
              width: 200,
              height: 200,
              through: false,
            }),
          ),
        ).toEqual([1]);
      } finally {
        flipped.dispose();
      }
    } finally {
      index.dispose();
    }
  });
  it("respects ellipse coverage and the camera frustum", () => {
    const offscreen = [100, -1, 0, 102, -1, 0, 101, 1, 0];
    const behind = [-1, -1, 20, 1, -1, 20, 0, 1, 20];
    const index = new ScreenSelectionIndex([...front, ...offscreen, ...behind]);
    try {
      expect(
        Array.from(
          index.select(
            camera,
            { kind: "circle", start: [80, 80], end: [120, 130] },
            { width: 200, height: 200, through: true },
          ),
        ),
      ).toEqual([1, 0, 0]);
      expect(
        Array.from(
          index.select(
            camera,
            { kind: "circle", start: [0, 0], end: [20, 20] },
            { width: 200, height: 200, through: true },
          ),
        ),
      ).toEqual([0, 0, 0]);
    } finally {
      index.dispose();
    }
  });
  it("rejects invalid geometry and region inputs", () => {
    expect(() => new ScreenSelectionIndex([1, 2])).toThrow();
    expect(
      () => new ScreenSelectionIndex([...front.slice(0, 8), NaN]),
    ).toThrow();
    const index = new ScreenSelectionIndex(front);
    try {
      expect(() =>
        index.select(camera, full, { width: 0, height: 200, through: true }),
      ).toThrow();
    } finally {
      index.dispose();
    }
  });
});
