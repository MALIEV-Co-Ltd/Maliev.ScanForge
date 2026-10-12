import { expect, it, vi } from "vitest";
import { OrthographicCamera, Vector3 } from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { cameraMouseButtons } from "../src/mouse-input";

it("mouse orbit continues through both poles and a complete revolution", () => {
  const browserWindow = Object.assign(new EventTarget(), {
    pageXOffset: 0,
    pageYOffset: 0,
  });
  vi.stubGlobal("window", browserWindow);
  const element = Object.assign(new EventTarget(), {
    style: {},
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
    const step = (Math.PI * 2 * 300) / 80;
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
  } finally {
    controls.dispose();
    vi.unstubAllGlobals();
  }
});
