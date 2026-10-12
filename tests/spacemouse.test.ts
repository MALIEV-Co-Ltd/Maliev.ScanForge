import { describe, expect, it, vi } from "vitest";
import {
  SPACE_MOUSE_DEVICES,
  decodeSpaceMouseReport,
  filteredMotion,
  DEFAULT_SPACE_MOUSE,
  SpaceMouseController,
  spaceMouseMotionDevice,
  type HidDevice,
  type HidAccess,
  type HidCollection,
} from "../src/spacemouse";
class Device extends EventTarget implements HidDevice {
  vendorId = 0x046d;
  productId = 0xc626;
  productName = "Test navigator";
  opened = false;
  collections?: HidCollection[];
  open = vi.fn(async () => {
    this.opened = true;
  });
  close = vi.fn(async () => {
    this.opened = false;
  });
  send(reportId: number, values: number[]) {
    const data = new DataView(new ArrayBuffer(values.length * 2));
    values.forEach((value, index) => data.setInt16(index * 2, value, true));
    this.dispatchEvent(
      Object.assign(new Event("inputreport"), { reportId, data }),
    );
  }
}
class Access extends EventTarget implements HidAccess {
  getDevices?: () => Promise<HidDevice[]>;
  constructor(public device: Device) {
    super();
  }
  requestDevice = vi.fn(
    async (_options: Parameters<HidAccess["requestDevice"]>[0]) => [
      this.device,
    ],
  );
}
function fixture() {
  const device = new Device(),
    access = new Access(device),
    onMotion = vi.fn(),
    onButton = vi.fn(),
    onStatus = vi.fn();
  let now = 1000,
    id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const controller = new SpaceMouseController(
    access,
    onMotion,
    onButton,
    onStatus,
    () => now,
    (callback) => {
      frames.set(++id, callback);
      return id;
    },
    (frame) => {
      frames.delete(frame);
    },
  );
  return {
    device,
    access,
    controller,
    onMotion,
    onButton,
    onStatus,
    frames,
    advance: (milliseconds: number) => {
      now += milliseconds;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(now));
    },
  };
}
describe("SpaceMouse HID input", () => {
  it("does not replace reconnected status when an unplugged device closes late", async () => {
    const f = fixture();
    await f.controller.connect();
    let finishClose!: () => void;
    f.device.close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve;
        }),
    );
    const replacement = new Device();
    f.access.getDevices = vi.fn(async () => [replacement]);
    f.access.dispatchEvent(
      Object.assign(new Event("disconnect"), { device: f.device }),
    );
    f.access.dispatchEvent(
      Object.assign(new Event("connect"), { device: replacement }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(f.controller.connected).toBe(true);
    finishClose();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.onStatus.mock.lastCall?.[0]).toContain("Connected:");
    await f.controller.dispose();
    expect(replacement.close).toHaveBeenCalledOnce();
    expect(f.frames.size).toBe(0);
  });
  it("monitors attachment and reconnects an authorized device without a chooser", async () => {
    const f = fixture();
    f.access.getDevices = vi.fn(async () => [f.device]);
    f.access.dispatchEvent(
      Object.assign(new Event("connect"), { device: f.device }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(f.controller.connected).toBe(true);
    expect(f.access.requestDevice).not.toHaveBeenCalled();
    f.access.dispatchEvent(
      Object.assign(new Event("disconnect"), { device: f.device }),
    );
    await Promise.resolve();
    expect(f.controller.connected).toBe(false);
    f.access.dispatchEvent(
      Object.assign(new Event("connect"), { device: f.device }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(f.controller.connected).toBe(true);
    expect(f.device.open).toHaveBeenCalledTimes(2);
    await f.controller.dispose();
    const queries = vi.mocked(f.access.getDevices).mock.calls.length;
    f.access.dispatchEvent(
      Object.assign(new Event("connect"), { device: f.device }),
    );
    expect(f.access.getDevices).toHaveBeenCalledTimes(queries);
    expect(f.frames.size).toBe(0);
  });
  it("respects a manual disconnect until the user connects again", async () => {
    const f = fixture();
    f.access.getDevices = vi.fn(async () => [f.device]);
    await f.controller.restoreAuthorized();
    await f.controller.disconnect();
    f.access.dispatchEvent(
      Object.assign(new Event("connect"), { device: f.device }),
    );
    await Promise.resolve();
    expect(f.controller.connected).toBe(false);
    expect(f.access.getDevices).toHaveBeenCalledOnce();
    await f.controller.connect();
    expect(f.controller.connected).toBe(true);
    await f.controller.dispose();
  });
  it("checks permission on return to the application and releases monitor listeners", async () => {
    const page = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", page);
    const f = fixture();
    try {
      f.access.getDevices = vi.fn(async () => [f.device]);
      page.hidden = true;
      page.dispatchEvent(new Event("visibilitychange"));
      expect(f.access.getDevices).not.toHaveBeenCalled();
      page.hidden = false;
      page.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
      expect(f.controller.connected).toBe(true);
      await f.controller.dispose();
      page.dispatchEvent(new Event("visibilitychange"));
      expect(f.access.getDevices).toHaveBeenCalledOnce();
    } finally {
      await f.controller.dispose();
      vi.unstubAllGlobals();
    }
  });
  it("chooses a motion-report interface instead of a button-only interface", () => {
    const buttons = new Device(),
      motion = new Device();
    buttons.collections = [
      { usagePage: 1, usage: 8, inputReports: [{ reportId: 3 }], children: [] },
    ];
    motion.collections = [
      {
        usagePage: 1,
        usage: 8,
        inputReports: [{ reportId: 1 }, { reportId: 2 }],
        children: [],
      },
    ];
    expect(spaceMouseMotionDevice([buttons, motion])).toBe(motion);
    expect(spaceMouseMotionDevice([buttons])).toBeUndefined();
  });
  it("restores an authorized device without asking for permission again", async () => {
    const f = fixture();
    f.access.getDevices = vi.fn(async () => [f.device]);
    await f.controller.restoreAuthorized();
    expect(f.access.requestDevice).not.toHaveBeenCalled();
    expect(f.device.open).toHaveBeenCalledOnce();
    expect(f.onStatus.mock.lastCall?.[0]).toContain("waiting for motion");
    f.device.send(1, [175, 0, 0]);
    f.advance(20);
    expect(f.onMotion).toHaveBeenCalledOnce();
    expect(f.onStatus.mock.lastCall?.[0]).toContain("Receiving motion");
    const count = f.onStatus.mock.calls.length;
    f.device.send(1, [175, 0, 0]);
    expect(f.onStatus).toHaveBeenCalledTimes(count);
    await f.controller.dispose();
    expect(f.frames.size).toBe(0);
  });
  it("does not ask for a chooser when no previously authorized device exists", async () => {
    const f = fixture();
    f.access.getDevices = vi.fn(async () => []);
    await f.controller.restoreAuthorized();
    expect(f.controller.connected).toBe(false);
    expect(f.access.requestDevice).not.toHaveBeenCalled();
    await f.controller.dispose();
  });
  it("accepts split axis reports from a receiver as well as combined packets", () => {
    const data = new DataView(new ArrayBuffer(6));
    data.setInt16(0, 350, true);
    expect(
      decodeSpaceMouseReport(SPACE_MOUSE_DEVICES[3], { reportId: 1, data })
        ?.translation?.[0],
    ).toBe(1);
    expect(
      decodeSpaceMouseReport(SPACE_MOUSE_DEVICES[3], { reportId: 2, data })
        ?.rotation?.[0],
    ).toBe(-1);
  });
  it("decodes signed split reports and rejects truncated/unknown reports", () => {
    const data = new DataView(new ArrayBuffer(6));
    data.setInt16(0, 350, true);
    data.setInt16(2, -175, true);
    data.setInt16(4, 70, true);
    expect(
      decodeSpaceMouseReport(SPACE_MOUSE_DEVICES[0], { reportId: 1, data }),
    ).toEqual({ translation: [1, 0.5, -0.2] });
    expect(
      decodeSpaceMouseReport(SPACE_MOUSE_DEVICES[0], { reportId: 2, data }),
    ).toEqual({ rotation: [-1, 0.5, 0.2] });
    expect(
      decodeSpaceMouseReport(SPACE_MOUSE_DEVICES[0], {
        reportId: 1,
        data: new DataView(new ArrayBuffer(2)),
      }),
    ).toBeNull();
    expect(
      decodeSpaceMouseReport(SPACE_MOUSE_DEVICES[0], { reportId: 90, data }),
    ).toBeNull();
  });
  it("decodes all six axes in wireless packets", () => {
    const data = new DataView(new ArrayBuffer(12));
    for (let i = 0; i < 6; i++) data.setInt16(i * 2, 350, true);
    expect(
      decodeSpaceMouseReport(SPACE_MOUSE_DEVICES[3], { reportId: 1, data }),
    ).toEqual({ translation: [1, -1, -1], rotation: [-1, -1, 1] });
  });
  it("applies deadzone, dominant axis and rotation lock without mutating input", () => {
    const motion = {
      translation: [0.02, 0.5, 0.1] as [number, number, number],
      rotation: [1, 0, 0] as [number, number, number],
    };
    const filtered = filteredMotion(motion, {
      ...DEFAULT_SPACE_MOUSE,
      rotationEnabled: false,
      dominantAxis: true,
    });
    expect(filtered.translation[0]).toBe(0);
    expect(filtered.translation[1]).toBeCloseTo(0.46 / 0.96);
    expect(filtered.translation[2]).toBe(0);
    expect(filtered.rotation).toEqual([0, 0, 0]);
    expect(motion.rotation[0]).toBe(1);
    expect(() =>
      filteredMotion(motion, { ...DEFAULT_SPACE_MOUSE, deadzone: 1 }),
    ).toThrow("Invalid");
  });
  it("restricts the chooser, decodes motion, expires stale axes and cancels owned frames", async () => {
    const f = fixture();
    await f.controller.connect();
    expect(
      f.access.requestDevice.mock.calls[0][0].filters.every(
        (filter) => filter.productId > 0,
      ),
    ).toBe(true);
    f.device.send(1, [350, 0, 0]);
    f.advance(20);
    expect(f.onMotion).toHaveBeenCalledTimes(1);
    expect(f.onMotion.mock.calls[0][1]).toBeCloseTo(0.02);
    f.advance(200);
    expect(f.onMotion).toHaveBeenCalledTimes(1);
    expect(f.frames.size).toBe(0);
    await f.controller.dispose();
    expect(f.device.close).toHaveBeenCalledTimes(1);
    expect(f.frames.size).toBe(0);
    f.device.send(1, [350, 0, 0]);
    expect(f.frames.size).toBe(0);
  });
  it("fires buttons only on a rising edge and retains externally opened devices", async () => {
    const f = fixture();
    f.device.opened = true;
    await f.controller.connect();
    f.device.send(3, [1]);
    f.device.send(3, [1]);
    expect(f.onButton).toHaveBeenCalledTimes(1);
    expect(f.onButton).toHaveBeenCalledWith("fit");
    await f.controller.dispose();
    expect(f.device.close).not.toHaveBeenCalled();
  });
  it("releases a device if disposal occurs during open", async () => {
    const f = fixture();
    let resolve!: () => void;
    f.device.open.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const connecting = f.controller.connect();
    await Promise.resolve();
    await f.controller.dispose();
    resolve();
    await connecting;
    expect(f.device.close).toHaveBeenCalledTimes(1);
    expect(f.controller.connected).toBe(false);
    expect(f.frames.size).toBe(0);
  });
  it("handles cancellation, missing API and unplug cleanup", async () => {
    const missing = new SpaceMouseController(
      undefined,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    await expect(missing.connect()).rejects.toThrow("WebHID");
    await missing.dispose();
    const f = fixture();
    await f.controller.connect();
    f.access.dispatchEvent(
      Object.assign(new Event("disconnect"), { device: f.device }),
    );
    await Promise.resolve();
    expect(f.controller.connected).toBe(false);
    expect(f.frames.size).toBe(0);
    await f.controller.dispose();
  });
});
