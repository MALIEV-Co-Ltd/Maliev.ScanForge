import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ShortcutText } from "../src/ui/Kbd";
import { ActiveToolHint } from "../src/ui/StatusFeedback";
import { shortcutReference } from "../src/ui/shortcut-reference";
it("renders mouse chords and modifiers as semantic keycaps without altering prose", () => {
  const html = renderToStaticMarkup(
    <ShortcutText text="Left-click selects · Ctrl+wheel changes brush size · Escape cancels" />,
  );
  expect(html).toContain('<kbd class="app-kbd">Left-click</kbd>');
  for (const key of ["Ctrl", "wheel", "Escape"])
    expect(html).toContain(`>${key}</kbd>`);
  expect(html).toContain(" changes brush size");
});
it("maps implemented shortcuts with local mode precedence and excludes unsupported routes", () => {
  const main = shortcutReference("main");
  expect(main.find((x) => x.keys.join("+") === "Ctrl+S")?.label).toBe(
    "Save project",
  );
  expect(main.some((x) => x.label === "Magic wand")).toBe(false);
  expect(
    shortcutReference("selection", true).find((x) => x.keys[0] === "B")?.label,
  ).toBe("Filled brush");
  expect(
    shortcutReference("sketch", true).find((x) => x.keys[0] === "L")?.label,
  ).toBe("Draw line");
  expect(
    shortcutReference("primitive-fit", true).find((x) => x.keys[0] === "C")
      ?.label,
  ).toBe("Fit cylinder");
  expect(
    main.some((x) => ["Ctrl+2", "Ctrl+5", "Ctrl+6"].includes(x.keys.join("+"))),
  ).toBe(false);
  expect(
    shortcutReference("main", true, true).find(
      (x) => x.keys.join("+") === "Ctrl+F",
    )?.label,
  ).toBe("Open CAD fillet tools");
});
it("keeps complete instructions accessible while presenting the active controls and reference as keycaps", () => {
  const html = renderToStaticMarkup(
    <ActiveToolHint
      context={{
        mode: "brush",
        brushActive: true,
        selectionTool: "brush",
        hasSelection: true,
      }}
    />,
  );
  expect(html).toContain('title="Left-drag draws filled selection');
  expect(html).toContain('aria-label="Shortcut reference"');
  expect(html).toContain(">Alt</kbd>");
  expect(html).toContain(">U</kbd>");
  expect(
    renderToStaticMarkup(
      <ActiveToolHint context={{ mode: "inspect", busy: true }} />,
    ),
  ).not.toContain("Keyboard shortcuts");
});
