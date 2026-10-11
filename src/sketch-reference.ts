/** Frozen scan reference samples, separate from editable CAD sketch curves. */
export interface SketchReference {
  kind: "section";
  sourceId: string;
  axis: "x" | "y" | "z";
  offset: number;
  onSlicingPlane: boolean;
  selectedOnly: boolean;
  sampled: boolean;
  /** Local UV line pairs: u1,v1,u2,v2. */
  segments: number[];
}

export function validateSketchReference(
  input: unknown,
): asserts input is SketchReference {
  if (!input || typeof input !== "object")
    throw new Error("Invalid sketch reference.");
  const v = input as SketchReference;
  if (
    v.kind !== "section" ||
    typeof v.sourceId !== "string" ||
    !v.sourceId ||
    !["x", "y", "z"].includes(v.axis) ||
    !Number.isFinite(v.offset) ||
    Math.abs(v.offset) > 1e9 ||
    [v.onSlicingPlane, v.selectedOnly, v.sampled].some(
      (flag) => typeof flag !== "boolean",
    ) ||
    !Array.isArray(v.segments) ||
    !v.segments.length ||
    v.segments.length % 4 ||
    v.segments.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e9)
  )
    throw new Error("Invalid sketch reference samples or extraction metadata.");
}
