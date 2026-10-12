/** RGB channels in the mutable palette's native [0, 1] range. */
export type NoisePaletteColor = readonly [number, number, number];
/** Positive outer/endpoint/threshold, center, negative threshold/endpoint/outer. */
export type NoisePalette = readonly [
  NoisePaletteColor,
  NoisePaletteColor,
  NoisePaletteColor,
  NoisePaletteColor,
  NoisePaletteColor,
  NoisePaletteColor,
  NoisePaletteColor,
];

/** Defaults verified by executing the original palette reset (0x140abcff0). */
export const DEFAULT_NOISE_PALETTE: NoisePalette = [
  [0.3105882704257965, 0, 0],
  [0.6000000238418579, 0, 0],
  [0.6000000238418579, 0.6000000238418579, 0],
  [0, 0.6000000238418579, 0],
  [0, 0.6000000238418579, 0.6000000238418579],
  [0, 0, 0.6000000238418579],
  [0, 0, 0.3105882704257965],
];

const f = Math.fround;
const byte = (value: number): number => Math.trunc(value) & 255;

/**
 * Native Float32 color ramp, with unmatched gray from the comparison caller.
 * Strict threshold boundaries intentionally change color at +/- threshold.
 */
export function nativeNoiseColor(
  distance: number,
  threshold: number,
  palette: NoisePalette = DEFAULT_NOISE_PALETTE,
): [number, number, number] {
  if (!(threshold > 0) || !Number.isFinite(threshold))
    throw new RangeError("Comparison threshold must be positive and finite");
  if (Number.isNaN(distance)) return [50, 50, 50];
  const d = f(distance);
  const outer = threshold * 5;
  const endpoint =
    d > outer ? 0 : d < -outer ? 6 : Math.abs(d) < threshold ? 3 : -1;
  if (endpoint >= 0) {
    const color = palette[endpoint as 0 | 3 | 6];
    return [
      byte(f(f(color[0]) * 255)),
      byte(f(f(color[1]) * 255)),
      byte(f(f(color[2]) * 255)),
    ];
  }
  const t = f((Math.abs(d) - threshold) / (outer - threshold));
  const inverse = f(1 - t);
  const sum = f(f(inverse + 0) + t);
  const near = palette[d > 0 ? 2 : 4];
  const far = palette[d > 0 ? 1 : 5];
  const center = palette[3];
  const result: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel++) {
    const weighted = f(
      f(f(inverse * f(near[channel])) + f(f(center[channel]) * 0)) +
        f(t * f(far[channel])),
    );
    result[channel] = byte(Math.min(255, f(f(weighted * 255) / sum)));
  }
  return result;
}
