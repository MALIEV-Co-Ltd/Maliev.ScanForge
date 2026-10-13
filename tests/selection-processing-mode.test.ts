import { expect, it } from "vitest";
import { selectionProcessingMode } from "../src/selection-processing-mode";

it("shares smoothing classification across selected mesh, whole mesh, and point-cloud operations", () => {
  for (const operation of [
    { kind: "smooth" },
    { kind: "scanEdit", action: "smoothSelected" },
    { kind: "pointCloudEdit", action: "smooth" },
  ])
    expect(selectionProcessingMode(operation)).toBe("smoothing");
  for (const operation of [
    undefined,
    { kind: "scanEdit", action: "deleteSelected" },
    { kind: "scanTools", operation: { kind: "reducePolygons" } },
  ])
    expect(selectionProcessingMode(operation)).toBe("boundary");
});
