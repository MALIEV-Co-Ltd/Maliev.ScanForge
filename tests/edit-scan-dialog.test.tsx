import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EditScanDialog,
  type EditScanDialogProps,
} from "../src/ui/EditScanDialog";
const noop = () => {};
const defaults: EditScanDialogProps = {
  name: "Fixture scan",
  tool: "brush",
  onTool: noop,
  angle: 30,
  onAngle: noop,
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
  it("keeps unrecovered tools unavailable rather than substituting another operation", () => {
    const html = render();
    for (const label of [
      "Free hand",
      "Select by drawing a line",
      "Enlarge selection",
      "Shrink selection",
      "Edit holes",
      "Edit boundaries",
    ])
      expect(button(html, label)).toContain("disabled");
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
