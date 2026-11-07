import type { Positions } from "../types";
import type { ProcessingResult } from "../processing-client";
import type { CommandContext } from "./api";

/** Restrict read-only previews to an explicitly selected bridge edge pair. */
export function validateBridgePreview(args: Record<string, unknown>): boolean {
  if (args.previewOnly === undefined || args.previewOnly === false)
    return false;
  const op = args.operation as Record<string, unknown> | undefined;
  const index = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0;
  if (
    args.previewOnly !== true ||
    !op ||
    op.kind !== "scanEdit" ||
    op.action !== "fillHoles" ||
    op.mode !== "bridge" ||
    !Array.isArray(op.indices) ||
    op.indices.length !== 1 ||
    !index(op.indices[0]) ||
    !index(op.start) ||
    !index(op.end) ||
    (op.endBoundary !== undefined && !index(op.endBoundary)) ||
    ((op.endBoundary ?? op.indices[0]) === op.indices[0] &&
      op.start === op.end) ||
    ["createNew", "selectionOnly", "targetId", "targetIds"].some(
      (key) => args[key] !== undefined,
    )
  )
    throw new Error(
      "Bridge preview requires one start boundary and explicit distinct exposed edge references; endBoundary may select another boundary. Omit createNew, selectionOnly and targets.",
    );
  return true;
}

/** Publish only the added facets from the shared fill result, without model writes. */
export function bridgePreviewResponse(
  source: Positions,
  result: ProcessingResult,
  context: CommandContext,
) {
  context.check();
  const edit = result.scanEdit;
  const positions = edit?.positions;
  if (
    !edit ||
    !positions ||
    edit.diagnostics.filledHoles !== 1 ||
    positions.length <= source.length ||
    source.length % 9 !== 0 ||
    positions.length % 9 !== 0
  )
    throw new Error("Bridge preview did not produce a valid facet patch.");
  for (let i = 0; i < source.length; i++) {
    if (positions[i] !== Math.fround(source[i]))
      throw new Error("Bridge preview unexpectedly changed source geometry.");
  }
  const patch = Array.from(
    positions instanceof Float32Array
      ? positions.subarray(source.length)
      : positions.slice(source.length),
  );
  if (
    patch.some((value) => !Number.isFinite(value)) ||
    edit.diagnostics.addedTriangles !== patch.length / 9
  )
    throw new Error("Bridge preview produced invalid patch geometry.");
  const sourceTriangleCount = source.length / 9;
  return {
    preview: true,
    sourceTriangleCount,
    diagnostics: edit.diagnostics,
    artifact: context.artifact(
      JSON.stringify({
        positions: patch,
        sourceTriangleCount,
        diagnostics: edit.diagnostics,
      }),
      "bridge-preview.json",
      "application/json",
    ),
  };
}
