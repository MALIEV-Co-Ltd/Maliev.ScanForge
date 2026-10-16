import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScanToolsPanel } from "../src/ui/ScanToolsPanel";
it("exposes independent ShrinkWrap controls, local scopes and preview acceptance", () => {
  const html = renderToStaticMarkup(
    <ScanToolsPanel
      tool="shrinkwrap"
      entities={[]}
      onApply={() => {}}
      onAccept={() => {}}
      onCompare={() => {}}
      onClose={() => {}}
      onCancel={() => {}}
    />,
  );
  for (const label of [
    "ShrinkWrap",
    "Sample interval (mm)",
    "Gap fill (mm)",
    "Organic shape",
    "Add extra thickness (mm)",
    "Maximum surface deviation (mm)",
    "Selected triangles",
    "Isolated visible triangles",
    "Create new object",
  ])
    expect(html).toContain(label);
  expect(html).toContain('aria-label="Preview"');
});
