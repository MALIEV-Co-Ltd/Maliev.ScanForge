import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { createViewportGrid, renderSceneWithGrid } from "../src/viewport-grid";
import {
  DEFAULT_CAMERA_NEAR,
  updateCameraClipping,
} from "../src/camera-clipping";
import { createOriginGeometry } from "../src/origin";

for (const perspective of [false, true]) {
  it(`keeps origin axes in the model render range for tiny and distant parts (${perspective ? "perspective" : "orthographic"})`, () => {
    const scene = new THREE.Scene();
    const origin = createOriginGeometry();
    scene.add(origin);
    const gridScene = new THREE.Scene();
    const camera = perspective
      ? new THREE.PerspectiveCamera()
      : new THREE.OrthographicCamera();
    const renderer = {
      autoClear: true,
      clearDepth: vi.fn(),
      render: (current: THREE.Scene) => {
        if (current !== scene) return;
        const points = [
          new THREE.Vector3(),
          new THREE.Vector3(35, 0, 0),
          new THREE.Vector3(0, 35, 0),
        ];
        if (!perspective || camera.position.z > 35)
          points.push(new THREE.Vector3(0, 0, 35));
        for (const point of points)
          expect(Math.abs(point.project(camera).z)).toBeLessThan(1);
      },
    };
    try {
      for (const centerZ of [0, 20000]) {
        const bounds = new THREE.Box3(
          new THREE.Vector3(-0.05, -0.05, centerZ - 0.05),
          new THREE.Vector3(0.05, 0.05, centerZ + 0.05),
        );
        camera.position.set(0, 0, centerZ + 0.2);
        camera.lookAt(0, 0, centerZ);
        renderSceneWithGrid(
          renderer as unknown as THREE.WebGLRenderer,
          scene,
          gridScene,
          camera,
          bounds,
          new THREE.Box3().setFromObject(origin),
        );
        for (const z of [bounds.min.z, bounds.max.z])
          expect(
            Math.abs(new THREE.Vector3(0, 0, z).project(camera).z),
          ).toBeLessThan(1);
        if (centerZ === 20000) expect(camera.far).toBeGreaterThan(20000);
      }
    } finally {
      origin.traverse((object) => {
        const item = object as THREE.Mesh;
        item.geometry?.dispose();
        if (item.material)
          for (const material of [item.material].flat()) material.dispose();
      });
    }
  });
  it(`keeps empty-scene axes visible through both render passes (${perspective ? "perspective" : "orthographic"})`, () => {
    const scene = new THREE.Scene();
    const gridScene = new THREE.Scene();
    const grid = createViewportGrid();
    gridScene.add(grid);
    const camera = perspective
      ? new THREE.PerspectiveCamera()
      : new THREE.OrthographicCamera();
    camera.position.set(100, -100, 80);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.near = 200;
    camera.far = 201;
    const renderer = {
      autoClear: true,
      clearDepth: vi.fn(),
      render: (current: THREE.Scene) => {
        if (current === scene)
          for (const point of [
            new THREE.Vector3(),
            new THREE.Vector3(50, 0, 0),
            new THREE.Vector3(0, 50, 0),
            new THREE.Vector3(0, 0, 50),
          ])
            expect(Math.abs(point.project(camera).z)).toBeLessThan(1);
      },
    };
    try {
      renderSceneWithGrid(
        renderer as unknown as THREE.WebGLRenderer,
        scene,
        gridScene,
        camera,
        new THREE.Box3(),
      );
      expect(camera.near).toBe(perspective ? DEFAULT_CAMERA_NEAR : -10000);
      expect(camera.far).toBe(10000);
    } finally {
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
    }
  });
  it(`renders the fading grid beyond the model without widening ${perspective ? "perspective" : "orthographic"} model clipping`, () => {
    const scene = new THREE.Scene(),
      gridScene = new THREE.Scene();
    scene.background = new THREE.Color("#1c1c1c");
    const grid = createViewportGrid(10000);
    gridScene.add(grid);
    const camera = perspective
      ? new THREE.PerspectiveCamera()
      : new THREE.OrthographicCamera();
    camera.position.set(160, -200, 140);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    const bounds = new THREE.Box3(
      new THREE.Vector3(-20, -20, 0),
      new THREE.Vector3(20, 20, 40),
    );
    updateCameraClipping(camera, bounds);
    const modelNear = camera.near,
      modelFar = camera.far;
    const passes: {
      scene: THREE.Scene;
      near: number;
      far: number;
      background: unknown;
    }[] = [];
    const renderer = {
      autoClear: true,
      clearDepth: vi.fn(),
      render: (current: THREE.Scene) => {
        passes.push({
          scene: current,
          near: camera.near,
          far: camera.far,
          background: current.background,
        });
      },
    };
    try {
      renderSceneWithGrid(
        renderer as unknown as THREE.WebGLRenderer,
        scene,
        gridScene,
        camera,
        bounds,
      );
      expect(passes[0].scene).toBe(gridScene);
      expect(passes[0].far).toBeGreaterThan(modelFar);
      expect(passes[0].near).toBeLessThanOrEqual(modelNear);
      expect(passes[1]).toMatchObject({
        scene,
        near: modelNear,
        far: modelFar,
        background: null,
      });
      expect(renderer.clearDepth).toHaveBeenCalledOnce();
      expect(scene.background).toEqual(new THREE.Color("#1c1c1c"));
      expect(renderer.autoClear).toBe(true);
      expect(camera.near).toBe(modelNear);
      expect(camera.far).toBe(modelFar);
    } finally {
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
    }
  });
}

it("restores the background and camera if a render fails", () => {
  const scene = new THREE.Scene(),
    gridScene = new THREE.Scene();
  const background = new THREE.Color("#fff");
  scene.background = background;
  const camera = new THREE.OrthographicCamera();
  const bounds = new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, 1, 1),
  );
  updateCameraClipping(camera, bounds);
  const near = camera.near,
    far = camera.far;
  const renderer = {
    autoClear: false,
    clearDepth: vi.fn(),
    render: vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("render failed");
      }),
  };
  expect(() =>
    renderSceneWithGrid(
      renderer as unknown as THREE.WebGLRenderer,
      scene,
      gridScene,
      camera,
      bounds,
    ),
  ).toThrow("render failed");
  expect(scene.background).toBe(background);
  expect(renderer.autoClear).toBe(false);
  expect(camera.near).toBe(near);
  expect(camera.far).toBe(far);
});
