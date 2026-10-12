import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NoiseComparisonLegend } from "../src/ui/NoiseComparisonLegend";
import { ScanToolsPanel } from "../src/ui/ScanToolsPanel";

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
