import { expect, it, vi } from "vitest";
import {
  Box3,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from "three";
import { createSpaceMouseCameraClient } from "../src/spacemouse-camera-client";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";

function fixture(
  camera = new OrthographicCamera(-50, 50, 50, -50, 0.1, 10000),
) {
  camera.position.set(0, -100, 0);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const target = new Vector3(),
    change = vi.fn(),
    motion = vi.fn();
  const client = createSpaceMouseCameraClient({
    camera: () => camera,
    target,
    bounds: () => new Box3(new Vector3(-5, -6, -7), new Vector3(5, 6, 7)),
    update: () => {
      camera.lookAt(target);
      camera.updateMatrixWorld();
      change();
    },
    motion,
  });
  return { camera, target, client, change, motion };
}
it("roundtrips the SDK camera-to-world matrix without losing roll or target direction", () => {
  const f = fixture();
  const q = new Quaternion().setFromAxisAngle(
    new Vector3(1, 1, 1).normalize(),
    0.7,
  );
  const matrix = new Matrix4().compose(
    new Vector3(10, 20, 30),
    q,
    new Vector3(1, 1, 1),
  );
  f.client.setViewMatrix(matrix.toArray());
  f.client.setTransaction(0);
  f.client
    .getViewMatrix()
    .forEach((value, index) =>
      expect(value).toBeCloseTo(matrix.elements[index], 10),
    );
  expect(f.client.getUnitsToMeters()).toBe(0.001);
  expect(f.motion).toHaveBeenCalled();
});
it("zooms orthographic extents with finite scale and preserves the camera projection", () => {
  const f = fixture();
  f.client.setViewExtents([-25, -25, -10000, 25, 25, -0.1]);
  expect(f.camera.zoom).toBeCloseTo(2);
  expect(f.client.getViewExtents()).toEqual([-25, -25, -10000, 25, 25, -0.1]);
});
it("rejects malformed poses before changing the viewport", () => {
  const f = fixture();
  const original = f.client.getViewMatrix();
  expect(() => f.client.setViewMatrix([NaN])).toThrow();
  expect(() =>
    f.client.setViewMatrix(new Matrix4().makeScale(0, 0, 0).toArray()),
  ).toThrow();
  expect(() => f.client.setViewExtents([0, 0, -100, 0, 0, -1])).toThrow();
  expect(f.client.getViewMatrix()).toEqual(original);
  expect(f.change).not.toHaveBeenCalled();
});
it("roundtrips off-center extents absolutely without repeatedly translating the camera", () => {
  const f = fixture();
  const position = f.camera.position.clone();
  const extents = [-10, -30, -2000, 40, 20, -0.5];
  f.client.setViewExtents(extents);
  f.client.setViewExtents(extents);
  expect(f.client.getViewExtents()).toEqual(extents);
  expect(f.camera.position.equals(position)).toBe(true);
  expect(f.client.getSelectionEmpty()).toBe(true);
});
it("reports effective perspective field-of-view and scene bounds in millimetres", () => {
  const camera = new PerspectiveCamera(60, 2, 0.1, 10000);
  const target = new Vector3();
  const client = createSpaceMouseCameraClient({
    camera: () => camera,
    target,
    bounds: () => new Box3(new Vector3(-1, -2, -3), new Vector3(1, 2, 3)),
    update: vi.fn(),
    motion: vi.fn(),
  });
  expect(client.getPerspective()).toBe(true);
  expect(client.getFov()).toBeCloseTo(Math.PI / 3);
  expect(client.getModelExtents()).toEqual([-1, -2, -3, 1, 2, 3]);
  client.setFov(Math.PI / 4);
  expect(camera.fov).toBeCloseTo(45);
});

it("preserves an absolute rolled driver pose through the real viewport orbit controller", () => {
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), { pageXOffset: 0, pageYOffset: 0 }),
  );
  const element = Object.assign(new EventTarget(), {
    style: {},
    clientWidth: 600,
    clientHeight: 600,
    ownerDocument: { documentElement: { clientLeft: 0, clientTop: 0 } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 }),
  });
  const camera = new OrthographicCamera(-50, 50, 50, -50, 0.1, 10000);
  camera.position.set(0, -100, 0);
  camera.up.set(0, 0, 1);
  const controls = new TrackballControls(
    camera,
    element as unknown as HTMLElement,
  );
  try {
    const client = createSpaceMouseCameraClient({
      camera: () => camera,
      target: controls.target,
      bounds: () => new Box3(),
      motion: vi.fn(),
      update: () => controls.update(),
    });
    const matrix = new Matrix4().compose(
      new Vector3(10, 20, 30),
      new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.8),
      new Vector3(1, 1, 1),
    );
    client.setViewMatrix(matrix.toArray());
    controls.update();
    client
      .getViewMatrix()
      .forEach((value, index) =>
        expect(value).toBeCloseTo(matrix.elements[index], 9),
      );
  } finally {
    controls.dispose();
    vi.unstubAllGlobals();
  }
});
