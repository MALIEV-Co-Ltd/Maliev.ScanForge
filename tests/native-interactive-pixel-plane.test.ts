import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { nativeInteractivePixelPlane } from "../src/interactive-alignment-math";
const native = JSON.parse(
  readFileSync(
    new URL("./fixtures/interactive-pixel-plane-native.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: {
    rectangle: number[];
    bounds: number[];
    point: number[];
    pixelMode: number;
    planeBits: string;
  }[];
};
it.each(native.cases.map((c, index) => ({ ...c, index })))(
  "matches original renderer pixel conversion $index",
  (c) => {
    const result = nativeInteractivePixelPlane({
      rectangle: c.rectangle,
      bounds: c.bounds,
      point: c.point,
      pixelMode: !!c.pixelMode,
    });
    expect(Buffer.from(Float32Array.from(result).buffer).toString("hex")).toBe(
      c.planeBits,
    );
  },
);
