import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { nativeInteractiveAspectBounds } from "../src/interactive-view-fit";
const native = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/interactive-aspect-adjustment-native.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { cases: any[] };
it.each(native.cases.map((c, index) => ({ ...c, index })))(
  "matches original viewport-aspect adjustment $index",
  (c) => {
    const result = nativeInteractiveAspectBounds(c.bounds, c.aspect);
    expect(
      Buffer.from(Float64Array.from(result.viewBounds).buffer).toString("hex"),
    ).toBe(c.outputBits);
    expect(
      Buffer.from(Float64Array.from(result.anchor).buffer).toString("hex"),
    ).toBe(c.anchorBits);
  },
);
