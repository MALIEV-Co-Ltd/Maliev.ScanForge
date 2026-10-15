import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
const native = JSON.parse(
  readFileSync(
    new URL("./fixtures/interactive-world-bounds-native.json", import.meta.url),
    "utf8",
  ),
) as {
  transforms: number[][];
  cases: {
    points: number[][];
    flags: number[];
    transform: number;
    boundsBits: string;
    valid: number;
  }[];
};
import { measureInteractiveBounds } from "../src/interactive-bounds-kernel";
it.each(native.cases.map((c, index) => ({ ...c, index })))(
  "matches original eight-lane world bounds $index",
  (c) => {
    const result = measureInteractiveBounds(
      Float32Array.from(c.points.flat()),
      native.transforms[c.transform],
      Uint32Array.from(c.flags),
    );
    expect(Buffer.from(result.values.buffer).toString("hex")).toBe(
      c.boundsBits,
    );
    expect(result.valid).toBe(!!c.valid);
  },
);
