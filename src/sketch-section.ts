import { sectionMesh } from "./geometry";
import {
  coordinateSketchFrame,
  sketchWorldPoint,
  type SketchFrame,
} from "./sketch-frame";
import {
  validateSketchReference,
  type SketchReference,
} from "./sketch-reference";
import type { Positions } from "./types";

export interface SketchSectionOptions {
  plane: "OXY" | "OYZ" | "OXZ";
  offset: number;
  onSlicingPlane: boolean;
  selectedOnly: boolean;
}
export interface SketchSectionResult {
  frame: SketchFrame;
  reference: SketchReference;
  actualSegments: number[];
  placedSegments: number[];
  eligibleTriangles: number;
}
export function referenceWorldSegments(
  frame: SketchFrame,
  reference: SketchReference,
): number[] {
  validateSketchReference(reference);
  const out: number[] = [];
  for (let i = 0; i < reference.segments.length; i += 2)
    out.push(
      ...sketchWorldPoint(frame, [
        reference.segments[i],
        reference.segments[i + 1],
      ]),
    );
  return out;
}
export function extractSketchSection(
  positions: Positions,
  options: SketchSectionOptions,
  sourceId: string,
  hidden: number[] = [],
  selection?: Uint8Array,
  sampled = false,
  onProgress?: (fraction: number, stage: string) => void,
): SketchSectionResult {
  const axis =
    options.plane === "OXY" ? "z" : options.plane === "OYZ" ? "x" : "y";
  const base = coordinateSketchFrame(options.plane, options.offset);
  if (
    typeof options.onSlicingPlane !== "boolean" ||
    typeof options.selectedOnly !== "boolean"
  )
    throw new Error("Invalid sketch slicing options.");
  const count = positions.length / 9;
  if (hidden.some((i) => !Number.isInteger(i) || i < 0 || i >= count))
    throw new Error("Hidden triangle slots are invalid.");
  if (options.selectedOnly && (!selection || selection.length !== count))
    throw new Error(
      "Select visible scan triangles before extracting a selected-only sketch.",
    );
  const hiddenSet = new Set(hidden);
  let eligibleTriangles = 0;
  const include = (i: number) =>
    !hiddenSet.has(i) && (!options.selectedOnly || !!selection![i]);
  for (let i = 0; i < count; i++) if (include(i)) eligibleTriangles++;
  if (!eligibleTriangles)
    throw new Error("No eligible visible scan triangles.");
  const section = sectionMesh(positions, axis, options.offset, {
    includeTriangle: include,
    onProgress,
  });
  if (!section.segments.length)
    throw new Error(
      "The slicing plane does not intersect the eligible scan region.",
    );
  const frame = options.onSlicingPlane
    ? base
    : coordinateSketchFrame(options.plane, 0);
  const segments: number[] = [];
  for (let i = 0; i < section.segments.length; i += 3) {
    const p = section.segments
      .slice(i, i + 3)
      .map((n, j) => n - base.origin[j]);
    segments.push(
      p.reduce((sum, n, j) => sum + n * base.u[j], 0),
      p.reduce((sum, n, j) => sum + n * base.v[j], 0),
    );
  }
  const reference: SketchReference = {
    kind: "section",
    sourceId,
    axis,
    offset: options.offset,
    onSlicingPlane: options.onSlicingPlane,
    selectedOnly: options.selectedOnly,
    sampled,
    segments,
  };
  validateSketchReference(reference);
  return {
    frame,
    reference,
    actualSegments: section.segments,
    placedSegments: referenceWorldSegments(frame, reference),
    eligibleTriangles,
  };
}
