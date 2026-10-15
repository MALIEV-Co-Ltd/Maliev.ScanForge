import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { nativeInteractiveFitView } from "../src/interactive-view-fit";
const native = JSON.parse(
  readFileSync(
    new URL("./fixtures/interactive-view-fit-native.json", import.meta.url),
    "utf8",
  ),
) as { frames: number[][]; cases: any[] };
it.each(native.cases.map((c, index) => ({ ...c, index })))(
  "matches original frame publication and 15-percent scene fit $index",
  (c) => {
    const result = nativeInteractiveFitView(
      native.frames[c.frame],
      c.bounds,
      [-123, 456],
    );
    for (const field of ["storedFrame", "viewBounds", "anchor"])
      expect(
        Buffer.from(
          Float64Array.from(result[field as keyof typeof result]).buffer,
        ).toString("hex"),
      ).toBe(c[field + "Bits"]);
    expect(
      Buffer.from(Float32Array.from(result.clipping).buffer).toString("hex"),
    ).toBe(c.clippingBits);
  },
);
