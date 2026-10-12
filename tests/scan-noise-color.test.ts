import { expect, it } from "vitest";
import captured from "./fixtures/noise-color-ramp.json";
import initialized from "./fixtures/noise-palette-default.json";
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

it("retains the mutable capture and its historical provenance", () => {
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

it.each(initialized.cases)(
  "matches original default initialization and ramp from buffer seed $seed",
  (capture) => {
    expect(initialized.provenance.resetProcedure).toBe("0x140abcff0");
    expect(initialized.provenance.globalInitializationCaller).toBe(
      "0x1407b9ad0",
    );
    expect(initialized.provenance.imageSha256).toBe(
      captured.provenance.imageSha256,
    );
    expect(initialized.provenance.applicationUiParity).toBe(false);
    expect(capture.headerUnchanged).toBe(true);
    expect(capture.guardsUnchanged).toBe(true);
    expect(capture.storedPalette).toEqual(capture.palette);
    expect(capture.palette.every((rgba) => rgba[3] === 1)).toBe(true);
    expect(DEFAULT_NOISE_PALETTE).toEqual(
      capture.palette.map((rgba) => rgba.slice(0, 3)),
    );
    expect(capture.samples).toHaveLength(932);
    for (const sample of capture.samples)
      expect(nativeNoiseColor(sample.distance, sample.threshold)).toEqual(
        sample.rgb,
      );
  },
);

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
