import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ShortcutText } from "../src/ui/Kbd";
import { ActiveToolHint, StatusKeyboard } from "../src/ui/StatusFeedback";
import { shortcutReference } from "../src/ui/shortcut-reference";
import type { ShortcutContext } from "../src/keyboard-shortcuts";
const shortcuts: ShortcutContext = {
  mode: "main",
  platform: "windows",
  allowExtensions: true,
  availableActions: new Set([
    "save",
    "clear-selection",
    "toggle-visibility",
    "selection-brush",
    "selection-through",
    "sketch-line",
    "fit-cylinder",
    "fillet",
  ]),
  visibilityCategories: ["meshes", "surfaces", "solids"],
};
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
  const main = shortcutReference(shortcuts);
  expect(main.find((x) => x.keys.join("+") === "Ctrl+S")?.label).toBe(
    "Save project",
  );
  expect(main.some((x) => x.label === "Magic wand")).toBe(false);
  expect(
    shortcutReference({ ...shortcuts, mode: "selection" }).find(
      (x) => x.keys[0] === "B",
    )?.label,
  ).toBe("Filled brush");
  expect(
    shortcutReference({ ...shortcuts, mode: "sketch" }).find(
      (x) => x.keys[0] === "L",
    )?.label,
  ).toBe("Draw line");
  expect(
    shortcutReference({ ...shortcuts, mode: "primitive-fit" }).find(
      (x) => x.keys[0] === "C",
    )?.label,
  ).toBe("Fit cylinder");
  expect(
    main.some((x) => ["Ctrl+2", "Ctrl+5", "Ctrl+6"].includes(x.keys.join("+"))),
  ).toBe(false);
  expect(
    shortcutReference(shortcuts).find((x) => x.keys.join("+") === "Ctrl+F")
      ?.label,
  ).toBe("Open CAD fillet tools");
});
it("separates the keyboard reference from active tool controls", () => {
  const html = renderToStaticMarkup(
    <>
      <StatusKeyboard shortcuts={{ ...shortcuts, mode: "selection" }} />
      <ActiveToolHint
        context={{
          mode: "brush",
          brushActive: true,
          selectionTool: "brush",
          hasSelection: true,
        }}
      />
    </>,
  );
  expect(html).toContain('title="Left-drag draws filled selection');
  expect(html).toContain('aria-label="Shortcut reference"');
  expect(html).toContain(
    'class="status-keyboard-icon" aria-label="Keyboard shortcuts"',
  );
  expect(html).not.toContain("Current tool controls");
  expect(html).not.toContain("status-controls");
  expect(html).toContain(">Alt</kbd>");
  expect(html).toContain(">U</kbd>");
  expect(renderToStaticMarkup(<StatusKeyboard busy />)).toContain(
    "Modeling shortcuts paused while processing.",
  );
});
