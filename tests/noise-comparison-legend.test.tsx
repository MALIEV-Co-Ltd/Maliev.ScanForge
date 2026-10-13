import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NoiseComparisonLegend } from "../src/ui/NoiseComparisonLegend";
import { ScanToolsPanel } from "../src/ui/ScanToolsPanel";

it("shows readable labels for the widened native Float32 threshold", () => {
  const markup = renderToStaticMarkup(
    <NoiseComparisonLegend
      threshold={Math.fround(0.05)}
      visible
      onToggle={() => {}}
    />,
  );
  expect(markup).toContain("−0.25 mm");
  expect(markup).toContain("±0.05");
  expect(markup).not.toContain("0.250000003");
});

it("labels original-surface distances and exposes both comparison states", () => {
  const shown = renderToStaticMarkup(
    <NoiseComparisonLegend threshold={0.05} visible onToggle={() => {}} />,
  );
  expect(shown).toContain("Signed distance from the original surface");
  expect(shown).toContain("Less than ±0.05 mm");
  expect(shown).toContain("No surface within 0.25 mm");
  expect(shown).toContain('aria-pressed="true"');
  expect(shown).toContain("Show smoothed result");
  const hidden = renderToStaticMarkup(
    <NoiseComparisonLegend
      threshold={0.05}
      visible={false}
      onToggle={() => {}}
    />,
  );
  expect(hidden).toContain("Show original comparison");
  expect(hidden).not.toContain("Signed distance");
});

it("shows the legend only for measured Reduce Noise results", () => {
  const props = {
    entities: [],
    onApply: () => {},
    onClose: () => {},
    onCancel: () => {},
    onToggleComparison: () => {},
    comparison: { threshold: 0.05, visible: true },
  };
  expect(
    renderToStaticMarkup(<ScanToolsPanel {...props} tool="reduceNoise" />),
  ).toContain("Original surface comparison");
  expect(
    renderToStaticMarkup(<ScanToolsPanel {...props} tool="scaleMesh" />),
  ).not.toContain("Original surface comparison");
  expect(
    renderToStaticMarkup(
      <ScanToolsPanel {...props} tool="reduceNoise" comparison={undefined} />,
    ),
  ).not.toContain("Original surface comparison");
});

it("labels reduced geometry separately from smoothing", () => {
  const props = {
    entities: [],
    onApply: () => {},
    onClose: () => {},
    onCancel: () => {},
    onToggleComparison: () => {},
    comparison: { threshold: 0.05, visible: true },
  };
  const markup = renderToStaticMarkup(
    <ScanToolsPanel {...props} tool="reducePolygons" />,
  );
  expect(markup).toContain("measured automatically");
  expect(markup).toContain("to the reduced result");
  expect(markup).toContain("Show reduced result");
  expect(markup).not.toContain("Show smoothed result");
});
