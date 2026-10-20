export type Motion6D = {
  translation: [number, number, number];
  rotation: [number, number, number];
};
export interface SpaceMousePreferences {
  translationSpeed: number;
  rotationSpeed: number;
  deadzone: number;
  dominantAxis: boolean;
  rotationEnabled: boolean;
}
export interface SpaceMouseCommand {
  action: "automatic" | "connectDriver" | "disconnect" | "preferences";
  preferences?: Partial<SpaceMousePreferences>;
}
export const DEFAULT_SPACE_MOUSE: SpaceMousePreferences = {
  translationSpeed: 1,
  rotationSpeed: 1,
  deadzone: 0.04,
  dominantAxis: false,
  rotationEnabled: true,
};
// Public USB identifiers/report layouts; provenance is recorded in docs/INPUT_DEVICES.md.
export const SPACE_MOUSE_DEVICES = [
  {
    vendorId: 0x046d,
    productId: 0xc626,
    name: "SpaceNavigator",
    combined: false,
    pro: false,
  },
  {
    vendorId: 0x046d,
    productId: 0xc62b,
    name: "SpaceMouse Pro",
    combined: false,
    pro: true,
  },
  {
    vendorId: 0x256f,
    productId: 0xc635,
    name: "SpaceMouse Compact",
    combined: false,
    pro: false,
  },
  {
    vendorId: 0x256f,
    productId: 0xc62e,
    name: "SpaceMouse Wireless",
    combined: true,
    pro: false,
  },
  {
    vendorId: 0x256f,
    productId: 0xc631,
    name: "SpaceMouse Pro Wireless",
    combined: true,
    pro: true,
  },
  {
    vendorId: 0x256f,
    productId: 0xc632,
    name: "SpaceMouse Pro Wireless",
    combined: true,
    pro: true,
  },
  {
    vendorId: 0x256f,
    productId: 0xc652,
    name: "3Dconnexion Universal Receiver",
    combined: true,
    pro: true,
  },
] as const;
export interface HidReport {
  reportId: number;
  data: DataView;
}
export interface HidDevice extends EventTarget {
  vendorId: number;
  productId: number;
  productName: string;
  opened: boolean;
  collections?: HidCollection[];
  open(): Promise<void>;
  close(): Promise<void>;
}
export interface HidCollection {
  usagePage: number;
  usage: number;
  inputReports: { reportId: number }[];
  children: HidCollection[];
}
export interface HidAccess extends EventTarget {
  getDevices?(): Promise<HidDevice[]>;
  requestDevice(options: {
    filters: { vendorId: number; productId: number }[];
  }): Promise<HidDevice[]>;
}
type DeviceSpec = (typeof SPACE_MOUSE_DEVICES)[number];
/** A chooser can return several interfaces for the same physical device. */
export function spaceMouseMotionDevice(
  devices: HidDevice[],
): HidDevice | undefined {
  const supported = devices.filter((device) => spaceMouseSpec(device));
  const reportsMotion = (collection: HidCollection): boolean =>
    collection.inputReports.some(
      (report) => report.reportId === 1 || report.reportId === 2,
    ) || collection.children.some(reportsMotion);
  return (
    supported.find((device) => device.collections?.some(reportsMotion)) ??
    supported.find((device) => device.collections === undefined)
  );
}
export function spaceMouseSpec(
  device: Pick<HidDevice, "vendorId" | "productId">,
): DeviceSpec | undefined {
  return SPACE_MOUSE_DEVICES.find(
    (spec) =>
      spec.vendorId === device.vendorId && spec.productId === device.productId,
  );
}
export function decodeSpaceMouseReport(
  spec: DeviceSpec,
  report: HidReport,
): {
  translation?: [number, number, number];
  rotation?: [number, number, number];
  buttons?: number;
} | null {
  const { reportId, data } = report;
  // Packet layout must not change the device's rotation coordinate system.
  const rotationSigns: [number, number, number] =
    spec.productId === 0xc62b ? [1, -1, -1] : [-1, -1, 1];
  const read = (
    offset: number,
    signs: [number, number, number],
  ): [number, number, number] =>
    signs.map(
      (sign, index) =>
        Math.max(
          -1,
          Math.min(1, data.getInt16(offset + index * 2, true) / 350),
        ) * sign,
    ) as [number, number, number];
  if (reportId === 1 && data.byteLength >= 6) {
    return {
      translation: read(0, [1, -1, -1]),
      ...(data.byteLength >= 12 ? { rotation: read(6, rotationSigns) } : {}),
    };
  }
  if (reportId === 2 && data.byteLength >= 6)
    return {
      rotation: read(0, rotationSigns),
    };
  if (reportId === 3 && data.byteLength) {
    // Compact reports may include a leading reserved byte.
    const offset = spec.productId === 0xc635 && data.byteLength > 1 ? 1 : 0;
    return { buttons: data.getUint8(offset) };
  }
  return null;
}
export function filteredMotion(
  motion: Motion6D,
  preferences: SpaceMousePreferences,
): Motion6D {
  if (
    !Number.isFinite(preferences.deadzone) ||
    preferences.deadzone < 0 ||
    preferences.deadzone >= 1 ||
    !Number.isFinite(preferences.translationSpeed) ||
    preferences.translationSpeed < 0 ||
    !Number.isFinite(preferences.rotationSpeed) ||
    preferences.rotationSpeed < 0
  )
    throw new Error("Invalid SpaceMouse sensitivity.");
  const values = [...motion.translation, ...motion.rotation].map(
    (value, index) => {
      if (!Number.isFinite(value)) throw new Error("Invalid SpaceMouse axis.");
      const magnitude = Math.min(1, Math.abs(value));
      return magnitude <= preferences.deadzone ||
        (index >= 3 && !preferences.rotationEnabled)
        ? 0
        : ((Math.sign(value) * (magnitude - preferences.deadzone)) /
            (1 - preferences.deadzone)) *
            (index < 3
              ? preferences.translationSpeed
              : preferences.rotationSpeed);
    },
  );
  if (preferences.dominantAxis) {
    const maximum = Math.max(...values.map(Math.abs));
    const index = values.findIndex((value) => Math.abs(value) === maximum);
    for (let i = 0; i < values.length; i++) if (i !== index) values[i] = 0;
  }
  return {
    translation: values.slice(0, 3) as [number, number, number],
    rotation: values.slice(3) as [number, number, number],
  };
}

/** One explicit user-selected HID session; no driver service or network bridge. */
export class SpaceMouseController {
  private device?: HidDevice;
  private openedHere = false;
  private disposed = false;
  private connecting = false;
  private generation = 0;
  private frame: number | null = null;
  private motion: Motion6D = { translation: [0, 0, 0], rotation: [0, 0, 0] };
  private translationAt = 0;
  private rotationAt = 0;
  private buttons = 0;
  private lastFrame = 0;
  private receivedMotion = false;
  private autoReconnect = true;
  private gamepad?: { index: number; name: string };
  private driverActive = false;
  preferences = { ...DEFAULT_SPACE_MOUSE };
  /** Notify the viewport before RAF so emulated wheel input cannot also zoom. */
  onInputMotion?: () => void;
  constructor(
    private access: HidAccess | undefined,
    private onMotion: (motion: Motion6D, seconds: number) => void,
    private onButton: (action: "fit" | "isometric") => void,
    private onStatus: (status: string) => void,
    private clock = () => performance.now(),
    private raf = (callback: FrameRequestCallback) =>
      requestAnimationFrame(callback),
    private cancel = (id: number) => cancelAnimationFrame(id),
  ) {
    access?.addEventListener("disconnect", this.unplug);
    access?.addEventListener("connect", this.plug);
    if (typeof window !== "undefined") {
      window.addEventListener("gamepadconnected", this.startAutomatic);
      window.addEventListener("gamepaddisconnected", this.startAutomatic);
    }
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", this.resumeMonitor);
  }
  get connected(): boolean {
    return this.driverActive || !!this.device || !!this.gamepad;
  }
  get source(): "driver" | "webhid" | "gamepad" | null {
    return this.driverActive
      ? "driver"
      : this.device
        ? "webhid"
        : this.gamepad
          ? "gamepad"
          : null;
  }
  /** Gamepad exposure follows browser interaction; never opens a permission chooser. */
  startAutomatic = (): void => {
    if (
      this.disposed ||
      !this.autoReconnect ||
      this.driverActive ||
      this.device
    )
      return;
    const input = this.readGamepad();
    if (!input) {
      if (this.gamepad)
        this.onStatus("Disconnected — move the SpaceMouse cap to detect it");
      this.gamepad = undefined;
      return;
    }
    if (
      this.gamepad?.index !== input.pad.index ||
      this.gamepad.name !== input.pad.id
    ) {
      this.receivedMotion = false;
      this.buttons = 0;
      this.onStatus(`Connected: ${input.pad.id} — Gamepad`);
    }
    this.gamepad = { index: input.pad.index, name: input.pad.id };
    if (this.frame === null) {
      this.lastFrame = this.clock();
      this.frame = this.raf(this.tick);
    }
  };
  setDriverActive(active: boolean): void {
    this.driverActive = active;
    if (active) {
      this.gamepad = undefined;
      if (this.frame !== null) this.cancel(this.frame);
      this.frame = null;
    } else {
      this.autoReconnect = true;
      this.startAutomatic();
    }
  }
  private readGamepad() {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return;
    try {
      for (const pad of navigator.getGamepads()) {
        if (!pad?.connected || pad.axes.length < 6) continue;
        const ids =
          /vendor:\s*([0-9a-f]{4}).*product:\s*([0-9a-f]{4})/i.exec(pad.id) ??
          /^([0-9a-f]{4})-([0-9a-f]{4})-/i.exec(pad.id);
        const spec = ids
          ? spaceMouseSpec({
              vendorId: parseInt(ids[1], 16),
              productId: parseInt(ids[2], 16),
            })
          : SPACE_MOUSE_DEVICES.find((s) =>
              [
                s.name.toLowerCase(),
                `3dconnexion ${s.name.toLowerCase()}`,
              ].includes(pad.id.trim().toLowerCase()),
            );
        if (spec) return { pad, spec };
      }
    } catch {
      /* Browser policy can deny controller enumeration. */
    }
  }
  /** Reopen only devices already permitted by this origin, without a chooser. */
  async restoreAuthorized(): Promise<void> {
    this.startAutomatic();
    if (this.gamepad) return;
    if (!this.access?.getDevices) return;
    await this.connect(true);
  }
  async connect(authorizedOnly = false): Promise<void> {
    if (this.disposed) throw new Error("SpaceMouse controller is closed.");
    if (this.connecting || this.device) return;
    if (!authorizedOnly) this.autoReconnect = true;
    if (!this.access)
      throw new Error(
        "WebHID is unavailable. Use a supporting browser over HTTPS or localhost.",
      );
    this.connecting = true;
    const generation = this.generation;
    let chosen: HidDevice | undefined,
      opened = false;
    try {
      const devices = authorizedOnly
        ? await this.access.getDevices!()
        : await this.access.requestDevice({
            filters: SPACE_MOUSE_DEVICES.map(({ vendorId, productId }) => ({
              vendorId,
              productId,
            })),
          });
      chosen = spaceMouseMotionDevice(devices);
      if (!chosen) {
        this.onStatus(
          authorizedOnly
            ? "Disconnected — connect SpaceMouse to grant browser access"
            : "No SpaceMouse motion interface selected",
        );
        return;
      }
      if (this.disposed || generation !== this.generation) return;
      if (!chosen.opened) {
        await chosen.open();
        opened = true;
      }
      if (this.disposed || generation !== this.generation) {
        if (opened) await chosen.close();
        return;
      }
      this.device = chosen;
      this.gamepad = undefined;
      if (this.frame !== null) this.cancel(this.frame);
      this.openedHere = opened;
      this.receivedMotion = false;
      chosen.addEventListener("inputreport", this.report);
      this.onStatus(
        `Connected: ${chosen.productName || spaceMouseSpec(chosen)!.name} — waiting for motion reports`,
      );
      this.lastFrame = this.clock();
      this.frame = this.raf(this.tick);
    } catch (error) {
      if (opened && chosen && !this.device)
        await chosen.close().catch(() => {});
      throw error;
    } finally {
      this.connecting = false;
    }
  }
  private report = (event: Event): void => {
    if (!this.device) return;
    const value = decodeSpaceMouseReport(
      spaceMouseSpec(this.device)!,
      event as unknown as HidReport,
    );
    if (!value) return;
    if ((value.translation || value.rotation) && !this.receivedMotion) {
      this.receivedMotion = true;
      this.onStatus(
        `Receiving motion: ${this.device.productName || spaceMouseSpec(this.device)!.name}`,
      );
    }
    const now = this.clock();
    if (value.translation || value.rotation) {
      const input = filteredMotion(
        {
          translation: value.translation ?? [0, 0, 0],
          rotation: value.rotation ?? [0, 0, 0],
        },
        this.preferences,
      );
      if ([...input.translation, ...input.rotation].some((axis) => axis !== 0))
        this.onInputMotion?.();
    }
    if (value.translation) {
      this.motion.translation = value.translation;
      this.translationAt = now;
    }
    if (value.rotation) {
      this.motion.rotation = value.rotation;
      this.rotationAt = now;
    }
    if (value.buttons !== undefined) {
      const pressed = value.buttons & ~this.buttons;
      const pro = spaceMouseSpec(this.device)!.pro;
      if (pressed & (pro ? 2 : 1)) this.onButton("fit");
      if (pressed & (pro ? 4 : 2)) this.onButton("isometric");
      this.buttons = value.buttons;
    }
    if (this.frame === null) {
      this.lastFrame = now;
      this.frame = this.raf(this.tick);
    }
  };
  private tick = (): void => {
    this.frame = null;
    if (this.disposed || this.driverActive) return;
    if (!this.device) {
      if (typeof document !== "undefined" && document.hidden) return;
      const input = this.readGamepad();
      if (!input) {
        if (this.gamepad)
          this.onStatus("Disconnected — move the SpaceMouse cap to detect it");
        this.gamepad = undefined;
        return;
      }
      const { pad, spec } = input;
      this.gamepad = { index: pad.index, name: pad.id };
      const now = this.clock(),
        seconds = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
      this.lastFrame = now;
      // A malformed sample is not a disconnect; keep polling for the next report.
      if (!pad.axes.slice(0, 6).every(Number.isFinite)) {
        this.frame = this.raf(this.tick);
        return;
      }
      // SpaceMouse axes can exceed ±1; filteredMotion saturates finite input.
      const signs = spec.productId === 0xc62b ? [1, -1, -1] : [-1, -1, 1];
      const motion = filteredMotion(
        {
          translation: [pad.axes[0], -pad.axes[1], -pad.axes[2]],
          rotation: [
            pad.axes[3] * signs[0],
            pad.axes[4] * signs[1],
            pad.axes[5] * signs[2],
          ],
        },
        this.preferences,
      );
      if ([...motion.translation, ...motion.rotation].some((v) => v !== 0)) {
        if (!this.receivedMotion) {
          this.receivedMotion = true;
          this.onStatus(`Receiving motion: ${pad.id} — Gamepad`);
        }
        this.onInputMotion?.();
        this.onMotion(motion, seconds);
      }
      const buttons = pad.buttons
        .slice(0, 32)
        .reduce(
          (mask, button, index) =>
            button.pressed ? mask | (1 << index) : mask,
          0,
        );
      const pressed = buttons & ~this.buttons;
      if (pressed & (spec.pro ? 2 : 1)) this.onButton("fit");
      if (pressed & (spec.pro ? 4 : 2)) this.onButton("isometric");
      this.buttons = buttons;
      this.frame = this.raf(this.tick);
      return;
    }
    const now = this.clock();
    const seconds = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    const motion = filteredMotion(
      {
        translation:
          now - this.translationAt < 150 ? this.motion.translation : [0, 0, 0],
        rotation:
          now - this.rotationAt < 150 ? this.motion.rotation : [0, 0, 0],
      },
      this.preferences,
    );
    if (typeof document === "undefined" || !document.hidden)
      if (
        [...motion.translation, ...motion.rotation].some((value) => value !== 0)
      )
        this.onMotion(motion, seconds);
    if (
      [...motion.translation, ...motion.rotation].some((value) => value !== 0)
    )
      this.frame = this.raf(this.tick);
  };
  private unplug = (event: Event): void => {
    if ((event as Event & { device?: HidDevice }).device === this.device)
      void this.disconnect(false).catch((error) =>
        this.onStatus(`Disconnected: ${String(error)}`),
      );
  };
  /** Monitor already-granted HID permission; never opens a permission chooser. */
  private monitor = (): void => {
    if (
      this.disposed ||
      !this.autoReconnect ||
      this.gamepad ||
      this.driverActive ||
      !this.access?.getDevices
    )
      return;
    void this.connect(true).catch((error) =>
      this.onStatus(`SpaceMouse reconnect: ${String(error)}`),
    );
  };
  private plug = (event: Event): void => {
    const device = (event as Event & { device?: HidDevice }).device;
    if (device && spaceMouseSpec(device)) this.monitor();
  };
  private resumeMonitor = (): void => {
    if (!document.hidden) {
      this.startAutomatic();
      if (!this.gamepad && !this.driverActive) this.monitor();
    } else if (this.gamepad && this.frame !== null) {
      this.cancel(this.frame);
      this.frame = null;
    }
  };
  async disconnect(manual = true): Promise<void> {
    if (manual) this.autoReconnect = false;
    const generation = ++this.generation;
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
    const device = this.device,
      openedHere = this.openedHere;
    this.device = undefined;
    this.gamepad = undefined;
    this.driverActive = false;
    this.openedHere = false;
    this.motion = { translation: [0, 0, 0], rotation: [0, 0, 0] };
    this.buttons = 0;
    device?.removeEventListener("inputreport", this.report);
    if (device && openedHere) await device.close();
    if (generation === this.generation && !this.device)
      this.onStatus("Disconnected");
    if (!manual) this.startAutomatic();
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.access?.removeEventListener("disconnect", this.unplug);
    this.access?.removeEventListener("connect", this.plug);
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", this.resumeMonitor);
    if (typeof window !== "undefined") {
      window.removeEventListener("gamepadconnected", this.startAutomatic);
      window.removeEventListener("gamepaddisconnected", this.startAutomatic);
    }
    await this.disconnect();
  }
}
