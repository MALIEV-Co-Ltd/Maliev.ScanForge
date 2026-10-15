import { expect, it } from "vitest";
import * as THREE from "three";
import { resetInteractiveCamera } from "../src/interactive-camera-reset";
import {
  nativeInteractiveAspectBounds,
  nativeInteractiveFitView,
  nativeInteractivePerspectiveSetup,
} from "../src/interactive-view-fit";
import { nativeInteractiveResetView } from "../src/interactive-alignment-math";
const bounds = new THREE.Box3(
  new THREE.Vector3(-10, -20, -3),
  new THREE.Vector3(30, 20, 5),
);
it("leaves the current camera and target intact when reset validation fails", () => {
  const camera = new THREE.PerspectiveCamera(42, 1, -1, 10000);
  camera.zoom = 3;
  camera.position.set(4, 5, 6);
  const target = new THREE.Vector3(1, 2, 3);
  const original = camera.toJSON();
  expect(() =>
    resetInteractiveCamera(camera, target, bounds, 800, 600),
  ).toThrow();
  expect(camera.toJSON()).toEqual(original);
  expect(target.toArray()).toEqual([1, 2, 3]);
});
it.each([false, true])(
  "resets orthographic roll and uses native fitted XY framing, alternate=%s",
  (alternate) => {
    const camera = new THREE.OrthographicCamera(
      -100,
      100,
      100,
      -100,
      -10000,
      10000,
    );
    camera.position.set(80, -70, 90);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.zoom = 2;
    const target = new THREE.Vector3();
    const result = resetInteractiveCamera(
      camera,
      target,
      bounds,
      800,
      600,
      alternate,
    );
    const fit = nativeInteractiveFitView(
      nativeInteractiveResetView(alternate),
      [...bounds.min.toArray(), ...bounds.max.toArray()],
    );
    const aspect = nativeInteractiveAspectBounds(fit.viewBounds, 800 / 600);
    expect(result.fit).toEqual(fit);
    expect(target.toArray()).toEqual(aspect.anchor);
    expect(camera.zoom).toBe(1);
    expect(camera.left).toBe(aspect.viewBounds[0] - aspect.anchor[0]);
    expect(camera.top).toBe(aspect.viewBounds[4] - aspect.anchor[1]);
    if (!alternate) {
      expect(camera.up.toArray()).toEqual([0, 1, 0]);
      expect(camera.getWorldDirection(new THREE.Vector3()).toArray()).toEqual([
        -0, -0, -1,
      ]);
    }
  },
);
it("uses the post-aspect native anchor when Float32 bounds shift it at large world coordinates", () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000);
  camera.position.set(100, 100, 100);
  const target = new THREE.Vector3();
  const box = new THREE.Box3(
    new THREE.Vector3(134217728, -10, -5),
    new THREE.Vector3(134217728, 10, 5),
  );
  const { fit } = resetInteractiveCamera(camera, target, box, 800, 800);
  const adjusted = nativeInteractiveAspectBounds(fit.viewBounds, 1);
  expect(adjusted.anchor).not.toEqual(fit.anchor);
  expect(target.toArray()).toEqual(adjusted.anchor);
  expect(camera.left).toBe(adjusted.viewBounds[0] - adjusted.anchor[0]);
});
it("preserves perspective mode and places its eye using the original Float32 setup", () => {
  const camera = new THREE.PerspectiveCamera(42, 1, 0.001, 10000);
  camera.position.set(80, -70, 90);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  const target = new THREE.Vector3();
  const { fit } = resetInteractiveCamera(camera, target, bounds, 800, 600);
  const expected = nativeInteractivePerspectiveSetup(
    [...bounds.min.toArray(), ...bounds.max.toArray()],
    fit.anchor,
    42,
    800 / 600,
    [0.001, 10000],
  );
  expect(camera.position.toArray()).toEqual(expected.lookAt.slice(0, 3));
  expect(target.toArray()).toEqual(expected.lookAt.slice(3, 6));
  expect(camera.aspect).toBe(Math.fround(800 / 600));
});
it.each([
  new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000),
  new THREE.PerspectiveCamera(42, 1, 0.001, 10000),
])(
  "keeps a coincident point scan viewable with an explicit degenerate fallback",
  (camera) => {
    camera.position.set(10, -10, 10);
    const target = new THREE.Vector3();
    const result = resetInteractiveCamera(
      camera,
      target,
      new THREE.Box3(new THREE.Vector3(), new THREE.Vector3()),
      800,
      600,
    );
    expect(result.fallback).toBe(true);
    expect(camera.position.distanceTo(target)).toBeGreaterThan(0);
    expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
  },
);
