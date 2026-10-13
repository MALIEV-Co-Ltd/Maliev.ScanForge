import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { compareReductionSamples } from "../src/scan-reduction-comparison";
import { ScanPreviewSession } from "../src/scan-preview";
import { ScanToolsPanel } from "../src/ui/ScanToolsPanel";
import { linearProgress } from "../src/reduction-report";
import { runScanTool } from "../src/scan-tools";

it("maps stage ranges without rewinding, accepting invalid numbers or reaching completion early", () => {
  const events: [number, string][] = [];
  const range = linearProgress((f, stage) => events.push([f, stage]));
  range(0, 0.75)(1, "Reduced");
  range(0.75, 0.99)(0, "Comparing");
  range(0.75, 0.99)(0.5, "Sampling");
  range(0.75, 0.99)(0.1, "Next process");
  range(0.75, 0.99)(NaN, "Invalid");
  range(0.75, 0.99)(1, "Measured");
  expect(events).toEqual([
    [0.75, "Reduced"],
    [0.75, "Comparing"],
    [0.87, "Sampling"],
    [0.87, "Next process"],
    [0.99, "Measured"],
  ]);
  range(1, 1)(1, "Complete");
  expect(events.at(-1)).toEqual([1, "Complete"]);
});

it.each(["triangles", "percentage", "deviation"] as const)(
  "measures %s reduction without editing the original",
  (mode) => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const before = positions.slice();
    const result = runScanTool({
      kind: "scanTools",
      positions,
      operation: {
        kind: "reducePolygons",
        mode,
        targetTriangles: 1,
        percentage: 50,
        deviation: 0.05,
        measureDeviation: true,
      },
    });
    expect(result.noiseComparison?.statistics).toMatchObject({
      percentage: 100,
      originalTriangles: 1,
      reducedTriangles: 1,
    });
    expect(positions).toEqual(before);
  },
);

it("reports signed extrema and RMS over matched samples without treating misses as zero", () => {
  const hits = [-0.03, 0.04, undefined];
  const measured = compareReductionSamples(
    [0, 0, 0, 1, 0, 0, 2, 0, 0],
    0.035,
    0.05,
    (point) =>
      hits[point[0]] === undefined ? undefined : { distance: hits[point[0]]! },
  );
  expect(measured.statistics).toMatchObject({
    minimum: -0.03,
    maximum: 0.04,
    matched: 2,
    total: 3,
    within: 1,
    unmatched: 1,
  });
  expect(measured.statistics.rms).toBeCloseTo(
    Math.sqrt((0.03 ** 2 + 0.04 ** 2) / 2),
  );
  const missing = compareReductionSamples(
    [0, 0, 0],
    0.05,
    0.05,
    () => undefined,
  );
  expect(missing.statistics).toMatchObject({
    minimum: null,
    maximum: null,
    rms: null,
    unmatched: 1,
  });
});

it("keeps preparation, reduction and comparison progress monotonic and publishes measured statistics", async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const progress: number[] = [];
  const session = await ScanPreviewSession.create(
    {
      kind: "scanPreview",
      phase: "create",
      previewId: "report",
      positions,
      operation: { kind: "reducePolygons", mode: "deviation", deviation: 0.05 },
    },
    { onProgress: (f) => progress.push(f) },
  );
  expect(progress.every((f, i) => !i || f >= progress[i - 1])).toBe(true);
  progress.length = 0;
  const result = session.compare(
    0.05,
    0.05,
    { onProgress: (f) => progress.push(f) },
    0.05,
  );
  expect(progress.every((f, i) => !i || f >= progress[i - 1])).toBe(true);
  expect(progress.at(-1)).toBe(1);
  expect(result.noiseComparison.renderDistances).toEqual(
    new Float32Array([0, 0, 0]),
  );
  expect(result.noiseComparison.statistics).toMatchObject({
    minimum: 0,
    maximum: 0,
    rms: 0,
    percentage: 100,
    originalTriangles: 1,
    reducedTriangles: 1,
  });
});

it("keeps reduction identity while rendering one percentage bar and measured results", () => {
  const html = renderToStaticMarkup(
    <ScanToolsPanel
      tool="reducePolygons"
      entities={[]}
      progress="Comparing surfaces"
      progressFraction={0.82}
      busy
      onApply={() => {}}
      onCancel={() => {}}
      onClose={() => {}}
      comparison={{
        threshold: 0.05,
        visible: true,
        statistics: {
          minimum: -0.03,
          maximum: 0.04,
          rms: 0.02,
          percentage: 90,
          total: 10,
          matched: 9,
          within: 9,
          unmatched: 1,
          tolerance: 0.05,
          originalTriangles: 100,
          reducedTriangles: 50,
        },
      }}
      onToggleComparison={() => {}}
    />,
  );
  expect(html).toContain("Reduce polygons");
  expect(html).not.toContain("Deviation analysis</");
  expect(html.match(/role="progressbar"/g)).toHaveLength(1);
  expect(html).toContain('aria-valuenow="82"');
  expect(html).toContain("Minimum");
  expect(html).toContain("−0.030");
  expect(html).toContain("+0.040");
  expect(html).toContain("RMS");
  expect(html).toContain("90.00");
  expect(html).toContain("1 samples could not be measured");
  expect(html).not.toContain("Matched samples");
});

it("requires a completed deviation report for acceptance and always offers automatic measurement", () => {
  const panel = (measured: boolean) =>
    renderToStaticMarkup(
      <ScanToolsPanel
        tool="reducePolygons"
        selected={{
          id: "mesh",
          name: "Source",
          kind: "mesh",
          positions: new Float32Array(90),
          color: "#aaa",
          visible: true,
          opacity: 1,
        }}
        entities={[]}
        previewReady
        onApply={() => {}}
        onCancel={() => {}}
        onClose={() => {}}
        onAccept={() => {}}
        comparison={
          measured
            ? {
                threshold: 0.05,
                visible: true,
                statistics: {
                  minimum: 0,
                  maximum: 0,
                  rms: 0,
                  percentage: 100,
                  total: 1,
                  matched: 1,
                  within: 1,
                  unmatched: 0,
                  tolerance: 0.05,
                },
              }
            : undefined
        }
      />,
    );
  expect(panel(false)).toContain(">Preview</button>");
  expect(panel(false)).not.toContain(">Accept</button>");
  expect(panel(true)).not.toContain('disabled="">Accept');
  expect(panel(false)).not.toContain("Color threshold");
  expect(panel(false)).not.toContain("Measure deviation from original</label>");
});
