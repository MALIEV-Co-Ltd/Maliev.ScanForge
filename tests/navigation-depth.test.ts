import { expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  navigationDepthPoint,
  pickNavigationDepth,
} from "../src/navigation-depth";

it.each([false, true])(
  "unprojects packed depth on the exact off-centre ray (ortho: %s)",
  (ortho) => {
    const camera = ortho
      ? new THREE.OrthographicCamera(-5, 5, 5, -5, 1, 101)
      : new THREE.PerspectiveCamera(45, 1.5, 1, 101);
    camera.position.set(3, -7, 14);
    camera.lookAt(1, 2, 0);
    camera.updateMatrixWorld();
    const screen = new THREE.Vector2(0.473, -0.291);
    // packDepthToRGBA(0.5) is [128, 0, 0, 0] in Three r180.
    const point = navigationDepthPoint(
      new Uint8Array([128, 0, 0, 0]),
      screen,
      camera,
    )!;
    const projected = point.clone().project(camera);
    expect(projected.x).toBeCloseTo(screen.x, 12);
    expect(projected.y).toBeCloseTo(screen.y, 12);
    expect(projected.z).toBeCloseTo(0, 12);
    expect(
      navigationDepthPoint(
        new Uint8Array([255, 255, 255, 255]),
        screen,
        camera,
      ),
    ).toBeUndefined();
  },
);

it.each([false, true])(
  "restores renderer and releases borrowed depth resources even on failure (%s)",
  (fail) => {
    const geometry = new THREE.BoxGeometry();
    geometry.computeBoundingBox();
    const source = new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      clippingPlanes: [new THREE.Plane(new THREE.Vector3(1, 0, 0), -0.1)],
    });
    const mesh = new THREE.Mesh(geometry, source);
    mesh.position.set(5, 6, 7);
    const previousTarget = new THREE.WebGLRenderTarget(10, 10);
    const camera = new THREE.PerspectiveCamera(45, 2, 1, 101);
    camera.position.z = 10;
    camera.updateMatrixWorld();
    const screen = new THREE.Vector2(0.4, -0.2);
    const materialDisposed = vi.fn(),
      targetDisposed = vi.fn();
    const renderer = {
      autoClear: false,
      localClippingEnabled: false,
      getRenderTarget: () => previousTarget,
      getActiveCubeFace: () => 2,
      getActiveMipmapLevel: () => 3,
      getClearColor: (color: THREE.Color) => color.set(0x123456),
      getClearAlpha: () => 0.4,
      getDrawingBufferSize: (size: THREE.Vector2) => size.set(1600, 800),
      setRenderTarget: vi.fn((target) => {
        if (target !== previousTarget)
          target.addEventListener("dispose", targetDisposed);
      }),
      setClearColor: vi.fn(),
      render: vi.fn((scene, cropped) => {
        expect(cropped.far - cropped.near).toBeLessThan(2);
        const proxy = scene.children[0];
        expect(proxy.geometry).toBe(geometry);
        expect(proxy.matrix.elements).toEqual(mesh.matrixWorld.elements);
        expect(proxy.material.side).toBe(source.side);
        expect(proxy.material.clippingPlanes).toBe(source.clippingPlanes);
        proxy.material.addEventListener("dispose", materialDisposed);
        const onRay = new THREE.Vector3(screen.x, screen.y, 0).unproject(
          camera,
        );
        const croppedProjection = onRay.project(cropped);
        expect(croppedProjection.x).toBeCloseTo(0, 10);
        expect(croppedProjection.y).toBeCloseTo(0, 10);
        if (fail) throw Error("readback failed");
      }),
      readRenderTargetPixels: vi.fn((_target, _x, _y, _w, _h, bytes) =>
        bytes.set([128, 0, 0, 0]),
      ),
    };
    try {
      const pick = () =>
        pickNavigationDepth(renderer as any, camera, [mesh], screen);
      if (fail) expect(pick).toThrow("readback failed");
      else expect(pick()).toBeDefined();
      expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(
        previousTarget,
        2,
        3,
      );
      expect(renderer.setClearColor).toHaveBeenLastCalledWith(
        new THREE.Color(0x123456),
        0.4,
      );
      expect(renderer.autoClear).toBe(false);
      expect(renderer.localClippingEnabled).toBe(false);
      expect(materialDisposed).toHaveBeenCalledOnce();
      expect(targetDisposed).toHaveBeenCalledOnce();
      expect(mesh.geometry).toBe(geometry);
      expect(mesh.material).toBe(source);
    } finally {
      geometry.dispose();
      source.dispose();
      previousTarget.dispose();
    }
  },
);
