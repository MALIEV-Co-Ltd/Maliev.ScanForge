import { expect, it } from "vitest";
import native from "./fixtures/alignment-segmentation-slider-native.json";

it.each(native.cases)(
  "matches original slider dispatch for control $controlId at $slider",
  (sample) => {
    const bytes = Buffer.alloc(4);
    if (sample.controlId !== 0x462) {
      bytes.writeFloatLE(-7.5);
      expect(sample.degreeBits).toBe(bytes.toString("hex"));
      expect(sample.events).toEqual([
        { kind: "baseScroll" },
        { kind: "controlId", value: sample.controlId },
      ]);
      return;
    }
    const degrees = Math.fround(Math.fround(sample.slider * 8) / 100);
    bytes.writeFloatLE(degrees);
    expect(sample.degreeBits).toBe(bytes.toString("hex"));
    expect(sample.events).toEqual([
      { kind: "baseScroll" },
      { kind: "controlId", value: sample.controlId },
      { kind: "update", save: 1 },
      { kind: "message", id: 0x400 },
      { kind: "process", value: sample.slider / 100, redraw: 1 },
      { kind: "format", value: degrees },
      { kind: "saveProfile", flush: 1 },
    ]);
  },
);
