import { expect, it } from "vitest";
import { ScanPreviewSession } from "../src/scan-preview";
import { reductionDisplayColor } from "../src/reduction-display";

it("publishes bright facet colours and independent sample distances for tolerance adjustment", async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const preview = await ScanPreviewSession.create({
    kind: "scanPreview",
    phase: "create",
    previewId: "display",
    positions,
    operation: { kind: "reducePolygons", mode: "deviation", deviation: 0.05 },
  });
  const result = preview.compare(0.05, 0.05, {}, 0.05).noiseComparison;
  expect(result.displayRange).toBe(0.05);
  expect(result.sampleDistances).toHaveLength(3);
  for (let i = 0; i < 3; i++)
    expect(Array.from(result.rgb.subarray(i * 3, i * 3 + 3))).toEqual(
      reductionDisplayColor(0, 0.05),
    );
});
import { renderToStaticMarkup } from "react-dom/server";
import {
  ReductionColorScale,
  ReductionResults,
} from "../src/ui/ReductionResults";

it("uses the entered range with narrow, labelled adjustable upper and lower handles", () => {
  const html = renderToStaticMarkup(
    <ReductionColorScale
      threshold={0.05}
      tolerance={0.05}
      onToleranceChange={() => {}}
    />,
  );
  expect(html).toContain("+0.050");
  expect(html).toContain("−0.050");
  expect(html).not.toContain("0.250");
  expect(html).toContain('aria-label="Upper tolerance"');
  expect(html).toContain('aria-label="Lower tolerance"');
  expect(html.match(/role="slider"/g)).toHaveLength(2);
});

it("uses bright continuous colours consistent with the scale, including saturated endpoints", async () => {
  const { reductionDisplayColor } = await import("../src/reduction-display");
  expect(reductionDisplayColor(0.05, 0.05)).toEqual([255, 0, 0]);
  expect(reductionDisplayColor(-0.05, 0.05)).toEqual([0, 0, 255]);
  expect(reductionDisplayColor(0, 0.05)).toEqual([0, 255, 0]);
  expect(reductionDisplayColor(0.025, 0.05)).toEqual([255, 255, 0]);
  expect(reductionDisplayColor(-0.025, 0.05)).toEqual([0, 255, 255]);
  expect(reductionDisplayColor(NaN, 0.05)).toEqual([50, 50, 50]);
});

it("maps dragging to signed distances and counts asymmetric tolerance including misses", async () => {
  const { toleranceCoverage, toleranceAtPointer } =
    await import("../src/reduction-display");
  expect(toleranceAtPointer(25, 0, 100, 0.05)).toBeCloseTo(0.025);
  expect(toleranceAtPointer(75, 0, 100, 0.05)).toBeCloseTo(-0.025);
  expect(toleranceAtPointer(-10, 0, 100, 0.05)).toBe(0.05);
  expect(
    toleranceCoverage(
      new Float64Array([-0.03, 0, 0.02, 0.04, NaN]),
      -0.03,
      0.02,
    ),
  ).toEqual({ within: 3, percentage: 60 });
});

it("shows the essential results without duplicate method, tolerance and sample details", () => {
  const html = renderToStaticMarkup(
    <ReductionResults
      statistics={{
        minimum: -0.009,
        maximum: 0.019,
        rms: 0.001,
        percentage: 100,
        total: 10,
        matched: 10,
        within: 10,
        unmatched: 0,
        tolerance: 0.05,
      }}
    />,
  );
  expect(html).toContain("Minimum");
  expect(html).toContain("RMS");
  expect(html).toContain("Within tolerance");
  expect(html).not.toContain("Matched samples");
  expect(html).not.toContain("Original coordinates");
  expect(html).not.toContain("Signed original-vertex distances");
});
