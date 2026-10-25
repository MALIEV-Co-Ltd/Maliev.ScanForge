import { Color, SRGBColorSpace } from "three";
import type { Entity } from "./types";

/** Solid sRGB display colors: restrained midtones remain readable in both themes. */
const CAD_PALETTE = [
  "#709fcb",
  "#d9a15c",
  "#75b59a",
  "#b48bc2",
  "#cf7e78",
  "#b8bb70",
  "#70b8c5",
  "#d39db3",
  "#8c9bca",
  "#b59778",
  "#8cc49a",
  "#c5a7d4",
  "#d9ba78",
  "#739fa0",
  "#b67e92",
  "#a0b7cf",
] as const;
export const AUTO_COLOR_OBJECT_LIMIT = 10000;

/** Compute the complete assignment before publication; no geometry buffers are copied. */
export function autoColorScene(entities: Entity[]): {
  entities: Entity[];
  changed: number;
} {
  if (!entities.length)
    throw new Error("Add an object before using Auto colorize.");
  if (entities.length > AUTO_COLOR_OBJECT_LIMIT)
    throw new Error(
      `Auto colorize supports at most ${AUTO_COLOR_OBJECT_LIMIT} objects.`,
    );
  const colors: string[] = [],
    used = new Set<string>();
  const color = new Color();
  for (let candidate = 0; colors.length < entities.length; candidate++) {
    if (candidate >= 100000)
      throw new Error(
        "Could not assign unique colors within the palette budget.",
      );
    const value =
      candidate < CAD_PALETTE.length
        ? CAD_PALETTE[candidate]
        : `#${color
            .setHSL(
              ((candidate - CAD_PALETTE.length) * 0.618033988749895) % 1,
              0.42 + (candidate % 7) * 0.04,
              0.48 + (Math.floor(candidate / 7) % 6) * 0.04,
              SRGBColorSpace,
            )
            .getHexString(SRGBColorSpace)}`;
    // Quantization can merge nearby hues; admission guarantees unique stored RGB values.
    if (used.has(value)) continue;
    used.add(value);
    colors.push(value);
  }
  let changed = 0;
  const next = entities.map((entity, index) => {
    if (entity.color.toLowerCase() === colors[index]) return entity;
    changed++;
    return { ...entity, color: colors[index] };
  });
  return { entities: changed ? next : entities, changed };
}
