import { describe, expect, it } from "vitest";
import {
  resolveKeyboardShortcut,
  type ShortcutContext,
  type ShortcutKeyEvent,
  type ShortcutMode,
} from "../src/keyboard-shortcuts";
import {
  SHORTCUT_REGISTRY,
  modeShortcutBindings,
  shortcutChord,
  shortcutKeys,
  shortcutPlatform,
  VIEWPORT_VISIBILITY_CATEGORIES,
  matchesLocalShortcut,
  type ShortcutPlatform,
} from "../src/shortcut-registry";
import { shortcutReference } from "../src/ui/shortcut-reference";

const supported = new Set(SHORTCUT_REGISTRY.map((entry) => entry.action.id));
const context: ShortcutContext = {
  mode: "main",
  platform: "windows",
  availableActions: supported,
  allowExtensions: true,
};
function eventFor(chord: string, platform: ShortcutPlatform): ShortcutKeyEvent {
  const parts = chord.split("+");
  return {
    key: parts.at(-1)!,
    ctrlKey: parts.includes("Mod") && platform === "windows",
    metaKey: parts.includes("Mod") && platform === "mac",
    shiftKey: parts.includes("Shift"),
  };
}

describe.each(["windows", "mac"] as const)(
  "%s registry dispatch and display",
  (platform) => {
    it.each([
      "main",
      "selection",
      "sketch",
      "freeform",
      "primitive-fit",
    ] as const)(
      "lists every executable binding in %s with the same platform keys",
      (mode) => {
        const current = { ...context, platform, mode };
        const reference = shortcutReference(current).filter(
          (entry) => entry.enabled && entry.keys[0] !== "Escape",
        );
        const bindings = modeShortcutBindings(current);
        expect(
          new Set(bindings.map((entry) => shortcutChord(entry, platform))).size,
        ).toBe(bindings.length);
        for (const entry of bindings) {
          const chord = shortcutChord(entry, platform);
          expect(
            resolveKeyboardShortcut(eventFor(chord, platform), current),
          ).toEqual(entry.action);
          expect(reference).toContainEqual(
            expect.objectContaining({
              label: entry.label,
              keys: shortcutKeys(chord, platform),
            }),
          );
        }
        expect(reference).toHaveLength(bindings.length);
      },
    );
    it("shows deselect in every mode", () => {
      for (const mode of [
        "main",
        "selection",
        "sketch",
        "freeform",
        "primitive-fit",
      ] as ShortcutMode[]) {
        const current = { ...context, platform, mode };
        const chord = platform === "mac" ? "Mod+Shift+A" : "Mod+Q";
        expect(
          resolveKeyboardShortcut(eventFor(chord, platform), current)?.id,
        ).toBe("clear-selection");
        expect(shortcutReference(current)).toContainEqual(
          expect.objectContaining({
            label: "Deselect all",
            keys: platform === "mac" ? ["\u2318", "Shift", "A"] : ["Ctrl", "Q"],
            enabled: true,
          }),
        );
      }
    });
    it("preserves input, IME, repetition, busy operations and dialogs", () => {
      const current = { ...context, platform };
      const event = eventFor("Mod+S", platform);
      for (const guard of ["textEditing", "busy", "modalOpen"] as const)
        expect(
          resolveKeyboardShortcut(event, { ...current, [guard]: true }),
        ).toBeNull();
      for (const guard of [
        "isComposing",
        "repeat",
        "defaultPrevented",
        "altKey",
      ] as const)
        expect(
          resolveKeyboardShortcut({ ...event, [guard]: true }, current),
        ).toBeNull();
      expect(
        resolveKeyboardShortcut(
          { ...event, ctrlKey: true, metaKey: true },
          current,
        ),
      ).toBeNull();
    });
  },
);

it("detects Apple platforms without treating Windows or Linux as macOS", () => {
  for (const platform of ["MacIntel", "iPad", "iPhone"])
    expect(shortcutPlatform({ platform } as Navigator)).toBe("mac");
  for (const platform of ["Win32", "Linux x86_64", ""])
    expect(shortcutPlatform({ platform } as Navigator)).toBe("windows");
});

it("keeps macOS Quit and Hide app chords outside the application", () => {
  const current = { ...context, platform: "mac" as const };
  expect(
    resolveKeyboardShortcut({ key: "q", metaKey: true }, current),
  ).toBeNull();
  expect(
    resolveKeyboardShortcut({ key: "h", metaKey: true }, current),
  ).toBeNull();
  expect(
    resolveKeyboardShortcut(
      { key: "h", metaKey: true, shiftKey: true },
      current,
    )?.id,
  ).toBe("hide-meshes");
  expect(
    resolveKeyboardShortcut(
      { key: "z", metaKey: true, shiftKey: true },
      { ...current, allowExtensions: false },
    )?.id,
  ).toBe("redo-model");
});

it("retains implemented commands while marking selection and tool requirements", () => {
  const current: ShortcutContext = {
    ...context,
    supportedActions: new Set([
      "save",
      "clear-selection",
      "selection-through",
      "fit-cylinder",
      "sketch-line",
      "toggle-visibility",
      "rotate-view",
    ]),
    availableActions: new Set([
      "save",
      "clear-selection",
      "toggle-visibility",
      "rotate-view",
    ]),
    visibilityCategories: VIEWPORT_VISIBILITY_CATEGORIES,
    allowConfiguredRotation: false,
  };
  const rows = shortcutReference(current);
  expect(rows.find((row) => row.label === "Fit cylinder")).toMatchObject({
    enabled: false,
    scope: "Primitive fitting",
  });
  expect(rows.find((row) => row.label === "Draw line")).toMatchObject({
    enabled: false,
    scope: "Sketch",
  });
  expect(
    rows.some((row) =>
      [
        "Toggle references",
        "Toggle sketches",
        "Toggle point-clouds",
        "Rotate by navigation angle",
        "Trim sketch",
      ].includes(row.label),
    ),
  ).toBe(false);
  expect(
    resolveKeyboardShortcut({ key: "2", ctrlKey: true }, current),
  ).toBeNull();
  expect(
    resolveKeyboardShortcut({ key: "ArrowLeft", ctrlKey: true }, current),
  ).toBeNull();
});

it("preserves reserved tool keys instead of falling through to camera shortcuts", () => {
  const current = {
    ...context,
    mode: "sketch" as const,
    availableActions: new Set(["view-left"] as const),
  };
  expect(resolveKeyboardShortcut({ key: "l" }, current)).toBeNull();
  expect(
    shortcutReference(current).find((row) => row.label === "Left view")
      ?.enabled,
  ).toBe(false);
});

it("matches physical command keys for non-Latin layouts without guessing a Latin layout", () => {
  expect(
    resolveKeyboardShortcut({ key: "ๆ", code: "KeyQ", ctrlKey: true }, context)
      ?.id,
  ).toBe("clear-selection");
  expect(
    resolveKeyboardShortcut({ key: "q", code: "KeyA", ctrlKey: true }, context)
      ?.id,
  ).toBe("clear-selection");
  expect(
    resolveKeyboardShortcut(
      { key: "ๆ", code: "KeyQ", metaKey: true },
      { ...context, platform: "mac" },
    ),
  ).toBeNull();
});

it("registers Escape in the reference while leaving cancellation with its local owner", () => {
  expect(shortcutReference(context)).toContainEqual(
    expect.objectContaining({
      keys: ["Escape"],
      label: "Cancel active gesture / close dialog",
    }),
  );
  expect(matchesLocalShortcut({ key: "Escape" }, "cancel")).toBe(true);
  expect(matchesLocalShortcut({ key: "Escape", ctrlKey: true }, "cancel")).toBe(
    false,
  );
  expect(resolveKeyboardShortcut({ key: "Escape" }, context)).toBeNull();
});
