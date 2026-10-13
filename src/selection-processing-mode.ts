export type SelectionProcessingMode = "boundary" | "smoothing";

/** Shared GUI/API classification; visual feedback does not change the operation. */
export function selectionProcessingMode(
  operation: unknown,
): SelectionProcessingMode {
  if (!operation || typeof operation !== "object") return "boundary";
  const { kind, action } = operation as { kind?: string; action?: string };
  return kind === "smooth" ||
    (kind === "scanEdit" && action === "smoothSelected") ||
    (kind === "pointCloudEdit" && action === "smooth")
    ? "smoothing"
    : "boundary";
}
