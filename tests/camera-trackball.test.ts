import { expect, it, vi } from "vitest";
import { OrthographicCamera, Vector3 } from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { cameraMouseButtons } from "../src/mouse-input";
import { configureNavigationSensitivity } from "../src/camera-navigation";

it("mouse orbit continues through both poles and a complete revolution", () => {
  const browserWindow = Object.assign(new EventTarget(), {
    pageXOffset: 0,
    pageYOffset: 0,
  });
  vi.stubGlobal("window", browserWindow);
  const element = Object.assign(new EventTarget(), {
    style: {},
    clientWidth: 600,
    clientHeight: 600,
    ownerDocument: { documentElement: { clientLeft: 0, clientTop: 0 } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 }),
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  });
  const camera = new OrthographicCamera();
  camera.position.set(0, -100, 0);
  camera.up.set(0, 0, 1);
  const controls = new TrackballControls(
    camera,
    element as unknown as HTMLElement,
  );
  controls.staticMoving = true;
  configureNavigationSensitivity(camera, controls, 600, 600);
  controls.mouseButtons = cameraMouseButtons(false, {
    ctrlKey: false,
    shiftKey: false,
  });
  const dispatch = (type: string, y: number) =>
    element.dispatchEvent(
      Object.assign(new Event(type), {
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        pageX: 300,
        pageY: y,
      }),
    );
  try {
    const initial = camera.position.clone();
    dispatch("pointerdown", 300);
    const step = 600 / 80;
    let upsideDown = false;
    for (let i = 1; i <= 80; i++) {
      const previous = camera.position.clone();
      dispatch("pointermove", 300 + step * i);
      controls.update();
      expect(camera.position.distanceTo(previous)).toBeGreaterThan(1);
      expect(camera.position.length()).toBeCloseTo(100, 8);
      upsideDown ||= camera.up.dot(new Vector3(0, 0, 1)) < -0.9;
    }
    expect(upsideDown).toBe(true);
    expect(camera.position.distanceTo(initial)).toBeLessThan(1e-8);
    dispatch("pointerup", 300 + step * 80);
    element.dispatchEvent(
      Object.assign(new Event("wheel", { cancelable: true }), {
        deltaMode: 0,
        deltaY: -100,
      }),
    );
    controls.update();
    expect(camera.zoom).toBeGreaterThan(1.05);
    expect(camera.zoom).toBeLessThan(1.06);

    camera.left = -100;
    camera.right = 100;
    camera.top = 100;
    camera.bottom = -100;
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.mouseButtons = cameraMouseButtons(false, {
      ctrlKey: true,
      shiftKey: false,
    });
    const previousTarget = controls.target.clone();
    dispatch("pointerdown", 300);
    dispatch("pointermove", 360);
    controls.update();
    // A 60px pan in a 600px view traverses 10% of the visible 200-unit height.
    expect(controls.target.distanceTo(previousTarget)).toBeCloseTo(20, 8);
    dispatch("pointerup", 360);
  } finally {
    controls.dispose();
    vi.unstubAllGlobals();
  }
});
