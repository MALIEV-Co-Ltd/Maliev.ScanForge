import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { nativeInteractiveNormalizeMovement } from "../src/interactive-alignment-math";
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/interactive-movement-normalizer-native.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { cases: { input: number[]; outputBits: string }[] };
it.each(fixture.cases.map((c, index) => ({ ...c, index })))(
  "matches original Float32 movement normalization $index",
  (c) => {
    const result = nativeInteractiveNormalizeMovement(c.input);
    expect(Buffer.from(Float32Array.from(result).buffer).toString("hex")).toBe(
      c.outputBits,
    );
  },
);
