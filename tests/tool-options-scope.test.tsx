import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MeshTools, type MeshTool } from "../src/ui/MeshTools";
import { workspaceGroup, workspaceTitle } from "../src/ui/tool-panel-scope";
import { ToolTitle } from "../src/ui/controls";
const noop = () => {};
const render = (tool: MeshTool) =>
  renderToStaticMarkup(
    <MeshTools
      tool={tool}
      entities={[]}
      onReplace={noop}
      onCreateSegments={noop}
      onError={noop}
      onStatus={noop}
    />,
  );
it("shares an accessible title and close control across standalone commands", () => {
  const html = renderToStaticMarkup(
    <ToolTitle id="command-title" title="Create Sketch" onClose={noop} />,
  );
  expect(html).toContain('id="command-title"');
  expect(html).toContain('aria-label="Create Sketch"');
  expect(html).toContain('aria-label="Close Create Sketch"');
  expect(html).toContain('type="button"');
});
it("keeps refinement settings out of fine alignment", () => {
  const html = render("fineAlign");
  expect(html).toContain("Expected overlap (%)");
  expect(html).toContain("Advanced ICP settings</summary>");
  expect(html).not.toContain("Additional fixed surfaces");
  expect(html).not.toContain("Surface refinement samples");
  expect(html).not.toContain("Use multiple CPU cores");
});
it("offers structured alignment help from an accessible icon", () => {
  const html = render("fineAlign");
  expect(html).toContain('aria-label="Fine alignment help"');
  expect(html).toContain('popover="auto"');
  expect(html).toContain('role="tooltip"');
  expect(html).toContain("<strong>Start close.</strong>");
  expect(html).toContain("<strong>What moves?</strong>");
  expect(html).not.toContain('class="operation-help"');
});
it("gives surface refinement its own settings and workspace", () => {
  const html = render("surfaceRefinement" as MeshTool);
  expect(html).toContain("Surface refinement samples");
  expect(html).toContain("Refine indexed mesh surfaces");
  expect(html).not.toContain("Expected overlap (%)");
  expect(html).not.toContain("ICP maximum iterations");
  expect(workspaceGroup("surfaceRefinement")).toBe("processing");
  expect(workspaceTitle("surfaceRefinement")).toBe("Surface refinement");
});
