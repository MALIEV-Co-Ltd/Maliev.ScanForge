import { expect, it, vi } from "vitest";
import {
  captureSpaceMouseWheel,
  SpaceMouseInputGate,
} from "../src/spacemouse-input";

it("blocks driver wheel input before ribbon or other panel scroll handlers, then resumes normal scrolling", () => {
  let now = 1000;
  const gate = new SpaceMouseInputGate(() => now);
  const windowTarget = new EventTarget();
  const release = captureSpaceMouseWheel(windowTarget, gate);
  const ribbonScroll = vi.fn();
  windowTarget.addEventListener("wheel", ribbonScroll);
  const wheel = (deltaX: number, deltaY: number) =>
    Object.assign(new Event("wheel", { cancelable: true }), { deltaX, deltaY });
  try {
    windowTarget.dispatchEvent(wheel(60, 0));
    expect(ribbonScroll).toHaveBeenCalledOnce();
    gate.noteMotion();
    for (const [dx, dy] of [
      [60, 0],
      [0, 60],
      [40, 30],
    ]) {
      const event = wheel(dx, dy);
      expect(windowTarget.dispatchEvent(event)).toBe(false);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(ribbonScroll).toHaveBeenCalledOnce();
    now += 249;
    expect(windowTarget.dispatchEvent(wheel(60, 0))).toBe(false);
    now += 1;
    expect(windowTarget.dispatchEvent(wheel(60, 0))).toBe(true);
    expect(ribbonScroll).toHaveBeenCalledTimes(2);
    gate.noteMotion();
    release();
    expect(windowTarget.dispatchEvent(wheel(60, 0))).toBe(true);
    expect(ribbonScroll).toHaveBeenCalledTimes(3);
  } finally {
    release();
  }
});

it("refreshes suppression on every raw motion packet without preventing unrelated pointer events", () => {
  let now = 0;
  const gate = new SpaceMouseInputGate(() => now);
  const target = new EventTarget();
  const release = captureSpaceMouseWheel(target, gate);
  const pointer = vi.fn();
  target.addEventListener("pointerdown", pointer);
  try {
    gate.noteMotion();
    now = 200;
    gate.noteMotion();
    now = 400;
    expect(target.dispatchEvent(new Event("wheel", { cancelable: true }))).toBe(
      false,
    );
    target.dispatchEvent(new Event("pointerdown"));
    expect(pointer).toHaveBeenCalledOnce();
    now = 450;
    expect(target.dispatchEvent(new Event("wheel", { cancelable: true }))).toBe(
      true,
    );
  } finally {
    release();
  }
});
