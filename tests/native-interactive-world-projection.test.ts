import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { nativeInteractiveProjectPoint } from "../src/interactive-alignment-math";
const native = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/interactive-world-projection-native.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  frames: number[][];
  cases: {
    frame: number;
    pixelMode: boolean;
    anchor: number[];
    point: number[];
    model: number[];
    projection: number[];
    viewport: number[];
    outputBits: string;
  }[];
};
it.each(native.cases.map((c, index) => ({ ...c, index })))(
  "matches original world/view and GLU screen projection $index",
  (c) => {
    const output = nativeInteractiveProjectPoint({
      ...c,
      frame: native.frames[c.frame],
    });
    expect(Buffer.from(Float64Array.from(output).buffer).toString("hex")).toBe(
      c.outputBits,
    );
  },
);
