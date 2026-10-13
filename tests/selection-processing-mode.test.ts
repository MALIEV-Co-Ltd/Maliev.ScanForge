import { expect, it } from "vitest";
import { selectionProcessingMode } from "../src/selection-processing-mode";

it("shares the outward ripple across every processing operation", () => {
  for (const operation of [
    { kind: "smooth" },
    { kind: "scanEdit", action: "smoothSelected" },
    { kind: "pointCloudEdit", action: "smooth" },
    undefined,
    { kind: "scanEdit", action: "deleteSelected" },
    { kind: "scanEdit", action: "defeature" },
    { kind: "repair" },
    { kind: "scanTools", operation: { kind: "reducePolygons" } },
  ])
    expect(selectionProcessingMode(operation)).toBe("smoothing");
});
