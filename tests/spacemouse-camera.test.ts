import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import {
  SpaceMouseController,
  decodeSpaceMouseReport,
  SPACE_MOUSE_DEVICES,
  filteredMotion,
  DEFAULT_SPACE_MOUSE,
  type HidDevice,
  type HidAccess,
} from "../src/spacemouse";
import { navigateCamera } from "../src/camera-navigation";

describe("SpaceMouse to camera workflow", () => {
  it.each([false, true])(
    "gives sensitivity 4 faster orbit and pan from Pro HID reports (%s orthographic)",
    (orthographic) => {
      const spec = SPACE_MOUSE_DEVICES.find(
        (device) => device.productId === 0xc62b,
      )!;
      const data = new DataView(new ArrayBuffer(6));
      data.setInt16(0, 70, true);
      const preferences = {
        ...DEFAULT_SPACE_MOUSE,
        translationSpeed: 4,
        rotationSpeed: 4,
      };
      const rotation = decodeSpaceMouseReport(spec, {
        reportId: 2,
        data,
      })!.rotation!;
      for (const frames of [15, 30]) {
        const camera = orthographic
          ? new THREE.OrthographicCamera(-50, 50, 50, -50)
          : new THREE.PerspectiveCamera();
        camera.position.set(0, 0, 100);
        camera.lookAt(0, 0, 0);
        const target = new THREE.Vector3();
        const before = camera.quaternion.clone();
        const motion = filteredMotion(
          { translation: [0, 0, 0], rotation },
          preferences,
        );
        for (let frame = 0; frame < frames; frame++)
          navigateCamera(camera, target, motion, 0.25 / frames);
        // A modest 20% cap deflection now rotates 40 degrees in a quarter second.
        expect(before.angleTo(camera.quaternion)).toBeCloseTo(0.7);
        expect(camera.position.distanceTo(target)).toBeCloseTo(100);
      }
      const camera = orthographic
        ? new THREE.OrthographicCamera(-50, 50, 50, -50)
        : new THREE.PerspectiveCamera();
      camera.position.set(0, 0, 100);
      camera.lookAt(0, 0, 0);
      const target = new THREE.Vector3();
      const translation = decodeSpaceMouseReport(spec, {
        reportId: 1,
        data,
      })!.translation!;
      const motion = filteredMotion(
        { translation, rotation: [0, 0, 0] },
        preferences,
      );
      navigateCamera(camera, target, motion, 0.05);
      expect(target.x).toBeCloseTo(
        -(orthographic ? 50 : 100) * (2 / 3) * 1.6 * 0.05,
      );
    },
  );
  it.each([-1, 1])(
    "keeps Pro pitch continuous across packet layouts, with mixed motion (%s)",
    (direction) => {
      const spec = SPACE_MOUSE_DEVICES.find(
        (device) => device.productId === 0xc62b,
      )!;
      for (const depth of [0, 175]) {
        const camera = new THREE.OrthographicCamera(-50, 50, 50, -50);
        camera.position.set(0, 0, 100);
        camera.lookAt(0, 0, 0);
        const target = new THREE.Vector3();
        let translation: [number, number, number] = [0, 0, 0];
        for (let frame = 0; frame < 10; frame++) {
          const combined = frame % 2 === 0;
          const data = new DataView(new ArrayBuffer(combined ? 12 : 6));
          if (combined) data.setInt16(2, depth, true);
          data.setInt16(combined ? 6 : 0, direction * 175, true);
          const decoded = decodeSpaceMouseReport(spec, {
            reportId: combined ? 1 : 2,
            data,
          })!;
          translation = decoded.translation ?? translation;
          const motion = filteredMotion(
            { translation, rotation: decoded.rotation! },
            DEFAULT_SPACE_MOUSE,
          );
          const previousY = camera.position.y;
          navigateCamera(camera, target, motion, 0.016, new THREE.Vector3());
          expect((camera.position.y - previousY) * direction).toBeGreaterThan(
            0,
          );
          expect(camera.position.distanceTo(target)).toBeCloseTo(100);
        }
        const depthSpeed = filteredMotion(
          { translation: [0, -depth / 350, 0], rotation: [0, 0, 0] },
          DEFAULT_SPACE_MOUSE,
        ).translation[1];
        expect(camera.zoom).toBeCloseTo(
          Math.exp(-depthSpeed * 1.6 * 0.016 * 10),
        );
      }
    },
  );
  it.each([false, true])(
    "scales actual camera pan, zoom and orbit independently (%s orthographic)",
    (orthographic) => {
      const step = (axis: "pan" | "zoom" | "orbit", speed: number) => {
        const camera = orthographic
          ? new THREE.OrthographicCamera(-50, 50, 50, -50)
          : new THREE.PerspectiveCamera();
        camera.position.set(0, 0, 100);
        camera.lookAt(0, 0, 0);
        const target = new THREE.Vector3();
        const before = camera.position.clone();
        const motion = filteredMotion(
          {
            translation:
              axis === "pan"
                ? [0.5, 0, 0]
                : axis === "zoom"
                  ? [0, 0.5, 0]
                  : [0, 0, 0],
            rotation: axis === "orbit" ? [0.5, 0, 0] : [0, 0, 0],
          },
          {
            ...DEFAULT_SPACE_MOUSE,
            translationSpeed: speed,
            rotationSpeed: speed,
          },
        );
        navigateCamera(camera, target, motion, 0.016, new THREE.Vector3());
        return axis === "orbit"
          ? before.angleTo(camera.position)
          : axis === "zoom" && orthographic
            ? Math.abs(Math.log(camera.zoom))
            : before.distanceTo(camera.position);
      };
      for (const axis of ["pan", "zoom", "orbit"] as const) {
        expect(step(axis, 0)).toBeCloseTo(0);
        expect(step(axis, 20) / step(axis, 0.1)).toBeCloseTo(200);
        expect(
          step(axis, DEFAULT_SPACE_MOUSE.translationSpeed) / step(axis, 1),
        ).toBeCloseTo(3);
      }
    },
  );
  it("opens a chosen device, navigates six axes, expires stale motion and releases the connection", async () => {
    class Device extends EventTarget implements HidDevice {
      vendorId = 0x046d;
      productId = 0xc626;
      productName = "Synthetic navigation fixture";
      opened = false;
      closed = 0;
      async open() {
        this.opened = true;
      }
      async close() {
        this.opened = false;
        this.closed++;
      }
      send(reportId: number, values: number[]) {
        const data = new DataView(new ArrayBuffer(values.length * 2));
        values.forEach((v, i) => data.setInt16(i * 2, v, true));
        this.dispatchEvent(
          Object.assign(new Event("inputreport"), { reportId, data }),
        );
      }
    }
    const device = new Device();
    class Access extends EventTarget implements HidAccess {
      async requestDevice() {
        return [device];
      }
    }
    const access = new Access();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    const pivot = new THREE.Vector3();
    let now = 1000;
    let sequence = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const buttons: string[] = [];
    const controller = new SpaceMouseController(
      access,
      (motion, dt) => navigateCamera(camera, pivot, motion, dt),
      (action) => buttons.push(action),
      () => {},
      () => now,
      (callback) => {
        frames.set(++sequence, callback);
        return sequence;
      },
      (id) => {
        frames.delete(id);
      },
    );
    const tick = (ms: number) => {
      now += ms;
      const queued = [...frames.values()];
      frames.clear();
      queued.forEach((cb) => cb(now));
    };
    try {
      await controller.connect();
      expect(device.opened).toBe(true);
      const inputMotion = vi.fn();
      controller.onInputMotion = inputMotion;
      device.send(2, [0, 0, 0]);
      expect(inputMotion).not.toHaveBeenCalled();
      device.send(1, [350, 175, -70]);
      device.send(2, [140, -105, 70]);
      expect(inputMotion).toHaveBeenCalledTimes(2);
      // Input ownership is announced before the first camera animation frame.
      expect(pivot.length()).toBe(0);
      tick(16);
      expect(pivot.length()).toBeGreaterThan(0);
      expect(camera.position.distanceTo(pivot)).toBeCloseTo(100);
      expect(camera.position.x).not.toBe(0);
      expect(camera.up.length()).toBeCloseTo(1);
      device.send(3, [3]);
      expect(buttons).toEqual(["fit", "isometric"]);
      tick(160);
      const stopped = camera.position.clone();
      tick(16);
      expect(camera.position.equals(stopped)).toBe(true);
    } finally {
      await controller.dispose();
    }
    expect(device.closed).toBe(1);
    expect(frames.size).toBe(0);
    expect(controller.connected).toBe(false);
    const stopped = camera.position.clone();
    device.send(1, [350, 0, 0]);
    tick(16);
    expect(camera.position.equals(stopped)).toBe(true);
  });
});
