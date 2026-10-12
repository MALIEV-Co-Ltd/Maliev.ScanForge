import { expect, it } from "vitest";
import captured from "./fixtures/noise-color-ramp.json";
import {
  nativeNoiseColor,
  DEFAULT_NOISE_PALETTE,
  type NoisePalette,
} from "../src/scan-noise-color";

it("matches original color instructions with captured and alternate mutable palettes", () => {
  expect(captured.samples.length).toBeGreaterThan(100);
  for (const sample of captured.samples) {
    expect(
      nativeNoiseColor(
        sample.distance,
        sample.threshold,
        captured.palettes[sample.palette] as unknown as NoisePalette,
      ),
    ).toEqual(sample.rgb);
  }
});

it("uses the captured palette without claiming it is the original default", () => {
  expect(DEFAULT_NOISE_PALETTE).toEqual(captured.palettes[0]);
  expect(captured.provenance.capturedPaletteIsVerifiedNativeDefault).toBe(
    false,
  );
  expect(captured.provenance.applicationUiParity).toBe(false);
  expect(nativeNoiseColor(0, 1)).toEqual([0, 153, 0]);
  expect(nativeNoiseColor(1, 1)).toEqual([153, 153, 0]);
  expect(nativeNoiseColor(-1, 1)).toEqual([0, 153, 153]);
  expect(nativeNoiseColor(5, 1)).toEqual([153, 0, 0]);
  expect(nativeNoiseColor(-5, 1)).toEqual([0, 0, 153]);
  expect(nativeNoiseColor(Infinity, 1)).toEqual([79, 0, 0]);
  expect(nativeNoiseColor(-Infinity, 1)).toEqual([0, 0, 79]);
});

it("preserves strict threshold ties after Float32 distance rounding", () => {
  expect(nativeNoiseColor(1 - 1e-9, 1)).toEqual([153, 153, 0]);
  expect(nativeNoiseColor(1 - 1e-6, 1)).toEqual([0, 153, 0]);
  expect(nativeNoiseColor(5 + 1e-9, 1)).toEqual([153, 0, 0]);
  expect(nativeNoiseColor(5 + 1e-5, 1)).toEqual([79, 0, 0]);
  expect(nativeNoiseColor(3, 1)).toEqual([153, 76, 0]);
  expect(nativeNoiseColor(-3, 1)).toEqual([0, 76, 153]);
});

it("maps unmatched distances to caller gray and rejects invalid thresholds", () => {
  expect(nativeNoiseColor(NaN, 0.05)).toEqual([50, 50, 50]);
  expect(nativeNoiseColor(-0, 1)).toEqual(nativeNoiseColor(0, 1));
  for (const threshold of [0, -1, NaN, Infinity])
    expect(() => nativeNoiseColor(0, threshold)).toThrow(RangeError);
});
