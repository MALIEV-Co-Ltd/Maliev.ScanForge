import { describe, expect, it } from "vitest";
it("F2 renames selected objects without intercepting typing, dialogs or busy tools", () => {
  const context: ShortcutContext = {
    mode: "main",
    allowExtensions: true,
    availableActions: new Set(["rename-objects"]),
  };
  expect(resolveKeyboardShortcut({ key: "F2" }, context)).toEqual({
    id: "rename-objects",
  });
  for (const blocked of [
    { textEditing: true },
    { modalOpen: true },
    { busy: true },
    { availableActions: new Set<ShortcutActionId>() },
  ])
    expect(
      resolveKeyboardShortcut({ key: "F2" }, { ...context, ...blocked }),
    ).toBeNull();
});
import {
  keyboardTargetContext,
  hasVisibleKeyboardModal,
  resolveKeyboardShortcut,
  type ShortcutActionId,
  type ShortcutContext,
} from "../src/keyboard-shortcuts";

it("R enters interactive alignment while Shift+R keeps Right view and sketch R keeps arcs", () => {
  const context: ShortcutContext = {
    mode: "main",
    allowExtensions: true,
    availableActions: new Set([
      "align-interactive",
      "view-right",
      "sketch-arc",
    ]),
  };
  for (const mode of ["main", "selection"] as const)
    expect(resolveKeyboardShortcut({ key: "r" }, { ...context, mode })).toEqual(
      { id: "align-interactive" },
    );
  expect(
    resolveKeyboardShortcut({ key: "R", shiftKey: true }, context),
  ).toEqual({ id: "view-right" });
  expect(
    resolveKeyboardShortcut({ key: "r" }, { ...context, mode: "sketch" }),
  ).toEqual({ id: "sketch-arc" });
  for (const blocked of [
    { textEditing: true },
    { modalOpen: true },
    { busy: true },
    { availableActions: new Set<ShortcutActionId>() },
  ])
    expect(
      resolveKeyboardShortcut({ key: "r" }, { ...context, ...blocked }),
    ).toBeNull();
  for (const guard of [
    "repeat",
    "isComposing",
    "defaultPrevented",
    "ctrlKey",
    "metaKey",
    "altKey",
  ] as const)
    expect(
      resolveKeyboardShortcut({ key: "r", [guard]: true }, context),
    ).toBeNull();
});

it("V toggles selected-object visibility and respects focus, dialogs, busy state and availability", () => {
  const context: ShortcutContext = {
    mode: "main",
    availableActions: new Set(["toggle-selected-visibility"]),
    allowExtensions: true,
  };
  expect(resolveKeyboardShortcut({ key: "v" }, context)).toEqual({
    id: "toggle-selected-visibility",
  });
  for (const blocked of [
    { textEditing: true },
    { modalOpen: true },
    { busy: true },
    { availableActions: new Set<ShortcutActionId>() },
  ])
    expect(
      resolveKeyboardShortcut({ key: "v" }, { ...context, ...blocked }),
    ).toBeNull();
});

it("hidden settings dialogs do not block workspace shortcuts, visible dialogs do", () => {
  const hidden = { getClientRects: () => [], closest: () => null };
  const visible = { getClientRects: () => [{}], closest: () => null };
  const root = (elements: unknown[]) =>
    ({ querySelectorAll: () => elements }) as unknown as Pick<
      Document,
      "querySelectorAll"
    >;
  expect(hasVisibleKeyboardModal(root([hidden]))).toBe(false);
  expect(hasVisibleKeyboardModal(root([hidden, visible]))).toBe(true);
});

it("falls back to model undo/redo when mesh selection has no local history", () => {
  for (const [key, id] of [
    ["z", "undo-model"],
    ["y", "redo-model"],
  ] as const) {
    expect(
      resolveKeyboardShortcut(
        { key, ctrlKey: true },
        {
          mode: "selection",
          platform: "windows",
          availableActions: new Set([id]),
        },
      ),
    ).toEqual({ id });
  }
});

const all = new Set<ShortcutActionId>([
  "new",
  "open",
  "save",
  "undo-model",
  "redo-model",
  "undo-selection",
  "redo-selection",
  "undo-sketch",
  "redo-sketch",
  "fit-view",
  "view-top",
  "view-bottom",
  "view-left",
  "view-right",
  "view-front",
  "view-back",
  "view-isometric",
  "rotate-view",
  "hide-selected",
  "hide-meshes",
  "new-sketch",
  "compare",
  "trim",
  "fillet",
  "selection-wand",
  "selection-brush",
  "selection-through",
  "clear-selection",
  "toggle-visibility",
  "toggle-selected-visibility",
  "sketch-line",
  "sketch-circle",
  "sketch-arc",
  "sketch-dimensions",
  "sketch-trim",
  "sketch-mirror",
  "sketch-offset",
  "sketch-join",
  "freeform-split",
  "freeform-smooth",
  "freeform-bridge",
  "freeform-refine",
  "fit-plane",
  "fit-cylinder",
  "fit-cone",
  "fit-sphere",
  "fit-line",
]);
const context: ShortcutContext = { mode: "main", availableActions: all };
const run = (
  key: string,
  extra: Partial<ShortcutContext> = {},
  ctrlKey = false,
  shiftKey = false,
) =>
  resolveKeyboardShortcut({ key, ctrlKey, shiftKey }, { ...context, ...extra });

describe("shipped keyboard shortcut catalog", () => {
  it.each([
    ["A", "fit-view"],
    ["T", "view-top"],
    ["M", "view-bottom"],
    ["L", "view-left"],
    ["F", "view-front"],
    ["K", "view-back"],
    ["I", "view-isometric"],
    ["H", "hide-selected"],
    ["S", "new-sketch"],
    ["D", "compare"],
    ["W", "selection-wand"],
  ])("maps %s to %s", (key, id) => expect(run(key)).toEqual({ id }));
  it.each([
    ["n", "new"],
    ["o", "open"],
    ["s", "save"],
    ["h", "hide-meshes"],
    ["q", "clear-selection"],
    ["t", "trim"],
    ["f", "fillet"],
  ])("maps Ctrl+%s to %s", (key, id) =>
    expect(run(key, {}, true)).toEqual({ id }),
  );
  it.each([
    ["1", "meshes"],
    ["2", "point-clouds"],
    ["3", "surfaces"],
    ["4", "solids"],
    ["5", "sketches"],
    ["6", "references"],
    ["7", "planes"],
    ["8", "cylinders"],
    ["9", "cones"],
    ["0", "spheres"],
    ["p", "primitives"],
  ])("maps category Ctrl+%s", (key, category) =>
    expect(run(key, {}, true)).toEqual({ id: "toggle-visibility", category }),
  );
  it.each(["left", "right", "up", "down"])(
    "routes %s arrow rotation",
    (direction) => {
      expect(run(`Arrow${direction}`)).toEqual({
        id: "rotate-view",
        direction,
        configuredAngle: false,
      });
      expect(run(`Arrow${direction}`, {}, true)).toEqual({
        id: "rotate-view",
        direction,
        configuredAngle: true,
      });
      expect(run(`Arrow${direction}`, { nativeControl: true })).toBeNull();
    },
  );
  it.each(["main", "selection", "sketch"] as const)(
    "routes undo to %s owner",
    (mode) => {
      const owner = mode === "main" ? "model" : mode;
      expect(run("z", { mode }, true)?.id).toBe(`undo-${owner}`);
      expect(run("y", { mode }, true)?.id).toBe(`redo-${owner}`);
    },
  );
  it.each([
    ["l", "sketch-line"],
    ["c", "sketch-circle"],
    ["r", "sketch-arc"],
    ["d", "sketch-dimensions"],
    ["t", "sketch-trim"],
    ["m", "sketch-mirror"],
    ["o", "sketch-offset"],
    ["j", "sketch-join"],
  ])("reserves sketch %s", (key, id) =>
    expect(run(key, { mode: "sketch" })).toEqual({ id }),
  );
  it("does not fall through to camera when an unsupported sketch chord is reserved", () => {
    expect(
      run("l", { mode: "sketch", availableActions: new Set(["view-left"]) }),
    ).toBeNull();
    expect(
      run("d", { mode: "freeform", availableActions: new Set(["compare"]) }),
    ).toBeNull();
  });
  it.each([
    ["s", "freeform-split"],
    ["q", "freeform-smooth"],
    ["d", "freeform-bridge"],
  ])("routes freeform %s", (key, id) =>
    expect(run(key, { mode: "freeform" })).toEqual({ id }),
  );
  it("routes refinement only in freeform mode", () => {
    expect(run("r", { mode: "freeform" }, true)).toEqual({
      id: "freeform-refine",
    });
    expect(run("r", {}, true)).toBeNull();
  });
  it.each([
    ["p", "fit-plane"],
    ["c", "fit-cylinder"],
    ["o", "fit-cone"],
    ["e", "fit-sphere"],
  ])("routes primitive-fit %s", (key, id) =>
    expect(run(key, { mode: "primitive-fit" })).toEqual({ id }),
  );
  it("routes Shift+L only to reference-line fitting", () => {
    expect(run("L", { mode: "primitive-fit" }, false, true)).toEqual({
      id: "fit-line",
    });
    expect(run("L", {}, false, true)).toBeNull();
  });
});

describe("shortcut admission and browser ownership", () => {
  it.each(["busy", "textEditing", "modalOpen"] as const)(
    "suppresses commands while %s",
    (property) => expect(run("s", { [property]: true }, true)).toBeNull(),
  );
  it.each([
    "repeat",
    "isComposing",
    "defaultPrevented",
    "altKey",
    "metaKey",
  ] as const)("suppresses %s events", (property) =>
    expect(
      resolveKeyboardShortcut(
        { key: "s", ctrlKey: true, [property]: true },
        context,
      ),
    ).toBeNull(),
  );
  it("requires available actions and exact modifiers", () => {
    expect(run("s", { availableActions: new Set() }, true)).toBeNull();
    expect(run("s", {}, true, true)).toBeNull();
    expect(run("ArrowLeft", {}, false, true)).toBeNull();
  });
  it("keeps independently chosen extensions explicit", () => {
    expect(run("b", { mode: "selection" })).toBeNull();
    expect(run("u", { mode: "selection", allowExtensions: true })).toEqual({
      id: "selection-through",
    });
    expect(run("b", { mode: "selection", allowExtensions: true })).toEqual({
      id: "selection-brush",
    });
    expect(run("z", {}, true, true)).toBeNull();
    expect(run("z", { allowExtensions: true }, true, true)).toEqual({
      id: "redo-model",
    });
    expect(run("y", { allowExtensions: true }, true, true)).toBeNull();
  });
  it("handles absent and non-element targets", () => {
    expect(keyboardTargetContext(null)).toEqual({
      textEditing: false,
      nativeControl: false,
    });
    expect(keyboardTargetContext({} as EventTarget)).toEqual({
      textEditing: false,
      nativeControl: false,
    });
  });
  it("asks closest for editable ancestors and native navigation controls", () => {
    const selectors: string[] = [];
    const target = {
      closest: (selector: string) => {
        selectors.push(selector);
        return {};
      },
    };
    expect(keyboardTargetContext(target as unknown as EventTarget)).toEqual({
      textEditing: true,
      nativeControl: true,
    });
    expect(selectors[0]).toContain(
      '[contenteditable]:not([contenteditable="false"])',
    );
    expect(selectors[1]).toContain('[role="menu"]');
  });
});
