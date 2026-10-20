import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SpaceMouseController,
  type HidAccess,
  type HidDevice,
} from "../src/spacemouse";

const controllers: SpaceMouseController[] = [];
afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.dispose();
  vi.unstubAllGlobals();
});

function fixture(id = "SpaceMouse Pro (Vendor: 046d Product: c62b)") {
  const pad = {
    id,
    index: 0,
    connected: true,
    mapping: "",
    timestamp: 1,
    axes: [0.5, 0.25, -0.25, 0.2, -0.3, 0.4],
    buttons: [
      { pressed: false, value: 0 },
      { pressed: false, value: 0 },
    ],
  };
  const getGamepads = vi.fn(() => [pad]);
  vi.stubGlobal("navigator", { getGamepads });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hidden: false }),
  );
  const device = Object.assign(new EventTarget(), {
    vendorId: 0x046d,
    productId: 0xc62b,
    productName: "SpaceMouse Pro",
    opened: false,
    open: vi.fn(async () => {
      device.opened = true;
    }),
    close: vi.fn(async () => {
      device.opened = false;
    }),
  }) as HidDevice;
  const access = Object.assign(new EventTarget(), {
    requestDevice: vi.fn(async () => [device]),
  }) as HidAccess;
  const motion = vi.fn(),
    button = vi.fn(),
    status = vi.fn();
  let now = 1000,
    sequence = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const controller = new SpaceMouseController(
    access,
    motion,
    button,
    status,
    () => now,
    (callback) => {
      frames.set(++sequence, callback);
      return sequence;
    },
    (frame) => {
      frames.delete(frame);
    },
  );
  controllers.push(controller);
  const advance = () => {
    now += 16;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(now));
  };
  return {
    controller,
    pad,
    access,
    device,
    motion,
    status,
    frames,
    advance,
    getGamepads,
  };
}

describe("automatic SpaceMouse Gamepad input", () => {
  it("starts without a HID chooser and sends six-axis navigation", async () => {
    const f = fixture();
    await f.controller.restoreAuthorized();
    f.advance();
    expect(f.controller.connected).toBe(true);
    expect(f.access.requestDevice).not.toHaveBeenCalled();
    expect(f.motion).toHaveBeenCalledOnce();
    expect(
      f.motion.mock.lastCall![0].translation.some((v: number) => v !== 0),
    ).toBe(true);
    expect(
      f.motion.mock.lastCall![0].rotation.some((v: number) => v !== 0),
    ).toBe(true);
  });
  it("does not take over an ordinary game controller", async () => {
    const f = fixture("Xbox Wireless Controller");
    await f.controller.restoreAuthorized();
    f.advance();
    expect(f.controller.connected).toBe(false);
    expect(f.motion).not.toHaveBeenCalled();
  });
  it("ignores malformed or nonfinite axis reports", async () => {
    const f = fixture();
    f.pad.axes[2] = NaN;
    await f.controller.restoreAuthorized();
    f.advance();
    expect(f.motion).not.toHaveBeenCalled();
  });
  it("keeps polling a connected device when cap values exceed the nominal axis range", async () => {
    const f = fixture();
    await f.controller.restoreAuthorized();
    f.advance();
    f.pad.axes[5] = -1.2;
    f.advance();
    expect(f.controller.connected).toBe(true);
    expect(f.frames.size).toBe(1);
    expect(f.motion.mock.lastCall![0].rotation.every(Number.isFinite)).toBe(
      true,
    );
    f.pad.axes[5] = 0.4;
    f.motion.mockClear();
    f.advance();
    expect(f.motion).toHaveBeenCalledOnce();
  });
  it("skips a malformed sample without disconnecting or abandoning subsequent motion", async () => {
    const f = fixture();
    await f.controller.restoreAuthorized();
    f.advance();
    f.motion.mockClear();
    f.pad.axes[0] = NaN;
    f.advance();
    expect(f.motion).not.toHaveBeenCalled();
    expect(f.controller.connected).toBe(true);
    expect(f.frames.size).toBe(1);
    f.pad.axes[0] = 0.3;
    f.advance();
    expect(f.motion).toHaveBeenCalledOnce();
  });
  it("uses the existing preferences immediately and marks wheel suppression before navigation", async () => {
    const f = fixture();
    const input = vi.fn();
    f.controller.onInputMotion = input;
    await f.controller.restoreAuthorized();
    f.advance();
    expect(input).toHaveBeenCalled();
    expect(input.mock.invocationCallOrder[0]).toBeLessThan(
      f.motion.mock.invocationCallOrder[0],
    );
    f.controller.preferences = {
      ...f.controller.preferences,
      translationSpeed: 0,
      rotationSpeed: 0,
    };
    f.motion.mockClear();
    f.advance();
    expect(f.motion).not.toHaveBeenCalled();
  });
  it("suspends motion when the page is hidden", async () => {
    const f = fixture();
    await f.controller.restoreAuthorized();
    Object.assign(document, { hidden: true });
    document.dispatchEvent(new Event("visibilitychange"));
    f.advance();
    expect(f.motion).not.toHaveBeenCalled();
  });
  it("does not emit Gamepad motion while a HID session owns navigation", async () => {
    const f = fixture();
    await f.controller.restoreAuthorized();
    await f.controller.connect();
    f.advance();
    expect(f.motion).not.toHaveBeenCalled();
  });
  it("clears connected state after unplugging", async () => {
    const f = fixture();
    await f.controller.restoreAuthorized();
    f.advance();
    f.pad.connected = false;
    window.dispatchEvent(new Event("gamepaddisconnected"));
    f.advance();
    expect(f.controller.connected).toBe(false);
  });
  it("cancels every scheduled frame and emits no further input after disposal", async () => {
    const f = fixture();
    await f.controller.restoreAuthorized();
    await f.controller.dispose();
    expect(f.frames.size).toBe(0);
    f.advance();
    expect(f.motion).not.toHaveBeenCalled();
  });
});
