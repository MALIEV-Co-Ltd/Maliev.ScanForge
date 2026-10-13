import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EditScanDialog,
  type EditScanDialogProps,
} from "../src/ui/EditScanDialog";
const noop = () => {};
const defaults: EditScanDialogProps = {
  name: "Fixture scan",
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  tool: "brush",
  onTool: noop,
  angle: 30,
  onAngle: noop,
  allConnected: false,
  onAllConnected: noop,
  brushRadius: 24,
  through: false,
  onThrough: noop,
  selectedCount: 0,
  hiddenCount: 0,
  wireframe: false,
  onWireframe: noop,
  canUndo: false,
  canRedo: false,
  onUndo: noop,
  onRedo: noop,
  onClear: noop,
  onInvert: noop,
  onHide: noop,
  onIsolate: noop,
  onReveal: noop,
  onCopy: noop,
  onCut: noop,
  onDelete: noop,
  onSave: noop,
  onClose: noop,
};
function render(props: Partial<EditScanDialogProps> = {}) {
  return renderToStaticMarkup(<EditScanDialog {...defaults} {...props} />);
}
function button(markup: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markup.match(
    new RegExp(`<button[^>]*aria-label="${escaped}"[^>]*>`),
  )?.[0];
}
describe("dedicated scan edit dialog", () => {
  it("labels selection buttons visibly and groups secondary operations in closed disclosures", () => {
    const html = render({ selectedCount: 12 });
    for (const [label, text] of [
      ["Magic wand", "Wand"],
      ["Free hand (filled)", "Brush"],
      ["Free hand", "Outline"],
      ["Select by drawing a line", "Line"],
      ["Select by drawing a rectangle", "Rectangle"],
      ["Select by drawing a circle", "Circle"],
      ["Select all triangles", "Select all"],
      ["Deselect all", "Clear"],
      ["Invert selection", "Invert"],
      ["Enlarge selection", "Enlarge"],
    ]) {
      const opening = button(html, label)!;
      const content = html.slice(
        html.indexOf(opening),
        html.indexOf("</button>", html.indexOf(opening)),
      );
      expect(content).toContain(`<span>${text}</span>`);
    }
    for (const heading of [
      "Mesh information",
      "Selection tools",
      "Selection actions",
      "Display",
    ])
      expect(html).toContain(heading);
    for (const title of [
      "More selection actions",
      "Additional tools &amp; display",
    ])
      expect(html).toMatch(
        new RegExp(`<details[^>]*><summary>${title}</summary>`),
      );
    expect(html).not.toMatch(/<details[^>]*\sopen(?:=|>)/);
    expect(html).toContain('aria-label="Edit Fixture scan"');
    expect(html).toContain("12 selected");
  });
  it("keeps connected-component settings contextual to the wand tool", () => {
    expect(render({ tool: "wand" })).toContain(
      "Select all connected triangles",
    );
    expect(render({ tool: "brush" })).not.toContain(
      "Select all connected triangles",
    );
  });
  it("disables angle filtering for connected-component wand selection", () => {
    const html = render({ tool: "wand", allConnected: true });
    expect(
      html.match(/<input[^>]*aria-label="Selection sensitivity"[^>]*>/)?.[0],
    ).toContain("disabled");
    expect(
      html.match(/<input[^>]*aria-label="Sensitivity degrees"[^>]*>/)?.[0],
    ).toContain("disabled");
    expect(
      render({ tool: "wand" }).match(
        /<input[^>]*aria-label="Sensitivity degrees"[^>]*>/,
      )?.[0],
    ).not.toContain("disabled");
  });
  it("exposes stroke tools while selection actions require working callbacks", () => {
    const html = render();
    for (const label of [
      "Enlarge selection",
      "Shrink selection",
      "Edit holes",
      "Edit boundaries",
    ])
      expect(button(html, label)).toContain("disabled");
    expect(button(html, "Free hand")).not.toContain("disabled");
    expect(button(html, "Select by drawing a line")).not.toContain("disabled");
    expect(button(html, "Free hand (filled)")?.includes("disabled")).toBe(
      false,
    );
    expect(html).not.toContain("Volume estimate");
    expect(html).not.toContain("Weld tolerance");
    expect(html).not.toContain("Uniform scale");
  });
  it("keeps through selection independent of the active tool", () => {
    const html = render({ tool: "rectangle", through: true });
    expect(button(html, "Select by drawing a rectangle")).toContain(
      'aria-pressed="true"',
    );
    expect(button(html, "Select through")).toContain('aria-pressed="true"');
    expect(button(html, "Magic wand")).toContain('aria-pressed="false"');
  });
  it("uses the sensitivity controls only for wand and enables display actions by selection state", () => {
    const html = render({ tool: "wand", selectedCount: 12, hiddenCount: 4 });
    expect(html).toContain('aria-label="Sensitivity degrees"');
    for (const label of [
      "Hide selected",
      "Isolate selected",
      "Show hidden",
      "Deselect all",
    ])
      expect(button(html, label)?.includes("disabled")).toBe(false);
    expect(render()).not.toContain('aria-label="Sensitivity degrees"');
    expect(button(render(), "Hide selected")).toContain("disabled");
    expect(button(render(), "Show hidden")).toContain("disabled");
  });
});

it("keeps the mesh identity in the object list instead of repeating it in the editing content", () => {
  const html = render();
  expect(html).not.toContain('class="edit-scan-name"');
  expect(html).toContain('aria-label="Edit Fixture scan"');
});

it("keeps mesh splitting and selected-area processing outside the Edit Scan content", () => {
  const html = render();
  expect(html).not.toContain("Mesh splitter");
  expect(html).not.toContain("Selected area</legend>");
  expect(html).not.toContain("Split mesh</legend>");
});

it("offers whole connected mesh selection after marking facets", () => {
  const html = renderToStaticMarkup(
    <EditScanDialog {...defaults} selectedCount={1} onConnected={noop} />,
  );
  expect(html).toContain("Select connected objects");
});
it("uses point labels and avoids mesh diagnostics and repatching for point clouds", () => {
  const html = renderToStaticMarkup(
    <EditScanDialog {...defaults} pointCloud onSelectAll={noop} />,
  );
  expect(html).toContain("Select all points");
  expect(html).toContain("Delete selected points");
  expect(html).not.toContain("Individual meshes");
  expect(html).not.toContain("Defeature selected");
});
