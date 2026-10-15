import { expect, it } from "vitest";
import native from "./fixtures/interactive-perspective-eye-native.json";
import { nativeInteractivePerspectiveSetup } from "../src/interactive-view-fit";
it.each(native.cases.map((c, index) => ({ ...c, index })))(
  "matches original perspective setup and Float32 eye $index",
  (c) => {
    const result = nativeInteractivePerspectiveSetup(
      c.bounds,
      c.anchor,
      c.fov,
      c.aspect,
      [0.001, 10000],
    );
    expect(
      Buffer.from(new Float64Array(result.perspective).buffer).toString("hex"),
    ).toBe(c.perspectiveBits);
    expect(
      Buffer.from(new Float64Array(result.lookAt).buffer).toString("hex"),
    ).toBe(c.lookAtBits);
  },
);
