import { matchKeybindingPress, parseKeybinding } from "tinykeys";
import type {
  ShortcutAction,
  ShortcutActionId,
  ShortcutContext,
  ShortcutKeyEvent,
  ShortcutMode,
  VisibilityCategory,
} from "./keyboard-shortcuts";

export type ShortcutPlatform = "mac" | "windows";

export function shortcutPlatform(
  source = typeof navigator === "undefined" ? undefined : navigator,
): ShortcutPlatform {
  return /Mac|iPhone|iPad|iPod/.test(source?.platform ?? "")
    ? "mac"
    : "windows";
}

export interface ShortcutBinding {
  chord: string;
  macChord?: string;
  label: string;
  action: ShortcutAction;
  modes?: readonly ShortcutMode[];
  extension?: boolean;
  platforms?: readonly ShortcutPlatform[];
}

const binding = (
  chord: string,
  label: string,
  id: ShortcutActionId,
  modes?: readonly ShortcutMode[],
  extension = false,
): ShortcutBinding => ({ chord, label, action: { id }, modes, extension });
const mainModes = ["main", "selection"] as const;
const modelModes = ["main", "freeform", "primitive-fit"] as const;

/** Both dispatch and the reference panel consume this catalog. Mod is platform-primary. */
export const SHORTCUT_REGISTRY: readonly ShortcutBinding[] = [
  binding("Mod+N", "New project", "new"),
  binding("Mod+O", "Open scan or project", "open"),
  binding("Mod+S", "Save project", "save"),
  ...(["model", "selection", "sketch"] as const).flatMap((owner) => {
    const modes = owner === "model" ? modelModes : [owner];
    return [
      binding("Mod+Z", "Undo", `undo-${owner}`, modes),
      {
        ...binding("Mod+Y", "Redo", `redo-${owner}`, modes),
        platforms: ["windows"] as const,
      },
      {
        ...binding("Mod+Shift+Z", "Redo", `redo-${owner}`, modes, true),
        platforms: ["windows"] as const,
      },
      {
        ...binding("Mod+Shift+Z", "Redo", `redo-${owner}`, modes),
        platforms: ["mac"] as const,
      },
    ];
  }),
  ...(
    [
      ["A", "Zoom to fit", "fit-view"],
      ["T", "Top view", "view-top"],
      ["M", "Bottom view", "view-bottom"],
      ["L", "Left view", "view-left"],
      ["R", "Right view", "view-right"],
      ["F", "Front view", "view-front"],
      ["K", "Back view", "view-back"],
      ["I", "Isometric view", "view-isometric"],
    ] as const
  ).map(([key, label, id]) => binding(key, label, id)),
  binding("H", "Hide selected object or facets", "hide-selected", mainModes),
  {
    ...binding("Mod+H", "Hide meshes", "hide-meshes"),
    macChord: "Mod+Shift+H",
  },
  {
    ...binding("Mod+Q", "Deselect all", "clear-selection"),
    macChord: "Mod+Shift+A",
  },
  binding("S", "Create sketch", "new-sketch", mainModes),
  binding("D", "Compare deviation", "compare", mainModes),
  binding("W", "Magic wand", "selection-wand", mainModes),
  binding("B", "Filled brush", "selection-brush", ["selection"], true),
  binding(
    "U",
    "Toggle see-through selection",
    "selection-through",
    ["selection"],
    true,
  ),
  binding("Mod+T", "Trim", "trim", mainModes),
  binding("Mod+F", "Open CAD fillet tools", "fillet", mainModes),
  ...(
    [
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
      ["P", "primitives"],
    ] as const
  ).map(([key, category]): ShortcutBinding => ({
    chord: `Mod+${key}`,
    label: `Toggle ${category}`,
    action: { id: "toggle-visibility", category },
    modes: mainModes,
  })),
  ...(["left", "right", "up", "down"] as const).flatMap(
    (direction): ShortcutBinding[] => [
      {
        chord: `Arrow${direction}`,
        label: "Rotate view 90\u00b0",
        action: { id: "rotate-view", direction, configuredAngle: false },
      },
      {
        chord: `Mod+Arrow${direction}`,
        label: "Rotate by navigation angle",
        action: { id: "rotate-view", direction, configuredAngle: true },
      },
    ],
  ),
  ...(
    [
      ["L", "Draw line", "sketch-line"],
      ["C", "Draw circle", "sketch-circle"],
      ["R", "Draw three-point arc", "sketch-arc"],
      ["D", "Toggle sketch constraints", "sketch-dimensions"],
      ["T", "Trim sketch", "sketch-trim"],
      ["M", "Mirror sketch", "sketch-mirror"],
      ["O", "Offset sketch", "sketch-offset"],
      ["J", "Join sketch", "sketch-join"],
    ] as const
  ).map(([key, label, id]) => binding(key, label, id, ["sketch"])),
  ...(
    [
      ["S", "Split edge", "freeform-split"],
      ["Q", "Smooth", "freeform-smooth"],
      ["D", "Bridge", "freeform-bridge"],
      ["Mod+R", "Refine", "freeform-refine"],
    ] as const
  ).map(([key, label, id]) => binding(key, label, id, ["freeform"])),
  ...(
    [
      ["P", "Fit plane", "fit-plane"],
      ["C", "Fit cylinder", "fit-cylinder"],
      ["O", "Fit cone", "fit-cone"],
      ["E", "Fit sphere", "fit-sphere"],
      ["Shift+L", "Fit reference line", "fit-line"],
    ] as const
  ).map(([key, label, id]) => binding(key, label, id, ["primitive-fit"])),
];

export const SHORTCUT_MODE_LABELS: Record<ShortcutMode, string> = {
  main: "Main",
  selection: "Mesh selection",
  sketch: "Sketch",
  freeform: "Freeform",
  "primitive-fit": "Primitive fitting",
};

export function shortcutKeys(
  chord: string,
  platform = shortcutPlatform(),
): string[] {
  return chord
    .split("+")
    .map((key) =>
      key === "Mod"
        ? platform === "mac"
          ? "\u2318"
          : "Ctrl"
        : key.startsWith("Arrow")
          ? key.slice(5).replace(/^./, (letter) => letter.toUpperCase())
          : key,
    );
}

export function shortcutChord(
  entry: ShortcutBinding,
  platform = shortcutPlatform(),
): string {
  return platform === "mac" ? (entry.macChord ?? entry.chord) : entry.chord;
}

/** Local chords reserve their keys even when their command is unavailable. */
export function modeShortcutBindings(
  context: ShortcutContext,
): ShortcutBinding[] {
  const platform = context.platform ?? shortcutPlatform();
  const eligible = SHORTCUT_REGISTRY.filter(
    (entry) => !entry.platforms || entry.platforms.includes(platform),
  );
  const local = eligible.filter((entry) => entry.modes?.includes(context.mode));
  const reserved = new Set(
    local.map((entry) => shortcutChord(entry, platform)),
  );
  return [
    ...local,
    ...eligible.filter(
      (entry) => !entry.modes && !reserved.has(shortcutChord(entry, platform)),
    ),
  ].filter((entry) => !entry.extension || context.allowExtensions);
}

export function supportedShortcutBinding(
  entry: ShortcutBinding,
  context: ShortcutContext,
): boolean {
  return (
    (!entry.extension || !!context.allowExtensions) &&
    (!entry.platforms ||
      entry.platforms.includes(context.platform ?? shortcutPlatform())) &&
    (!entry.action.configuredAngle ||
      context.allowConfiguredRotation !== false) &&
    (!entry.action.category ||
      !context.visibilityCategories ||
      context.visibilityCategories.includes(entry.action.category))
  );
}

export function availableShortcutBinding(
  entry: ShortcutBinding,
  context: ShortcutContext,
): boolean {
  return (
    supportedShortcutBinding(entry, context) &&
    context.availableActions.has(entry.action.id)
  );
}

const parsed = new Map<string, ReturnType<typeof parseKeybinding>[number]>();
export function matchesShortcutBinding(
  event: ShortcutKeyEvent,
  chord: string,
  platform = shortcutPlatform(),
): boolean {
  const key = `${platform}:${chord}`;
  let press = parsed.get(key);
  if (!press) {
    press = parseKeybinding(
      chord.replace("Mod", platform === "mac" ? "Meta" : "Control"),
    )[0];
    parsed.set(key, press);
  }
  // tinykeys uses getModifierState; preserve the lightweight event API for host/tests.
  const modifiers: Record<string, boolean> = {
    Control: !!event.ctrlKey,
    Meta: !!event.metaKey,
    Shift: !!event.shiftKey,
    Alt: !!event.altKey,
  };
  const input = {
    key: event.key,
    code: event.code ?? "",
    getModifierState: (name: string) => modifiers[name] ?? false,
  } as KeyboardEvent;
  if (matchKeybindingPress(input, press)) return true;
  // Use physical letter/digit keys when the active layout is not Latin (for example Thai).
  const last = chord.split("+").at(-1)!;
  return (
    !/^[a-z0-9]$/i.test(event.key) &&
    /^[A-Z0-9]$/.test(last) &&
    !!event.code &&
    matchKeybindingPress(input, [
      press[0],
      press[1],
      /^\d$/.test(last) ? `Digit${last}` : `Key${last}`,
    ])
  );
}

export const VIEWPORT_VISIBILITY_CATEGORIES: readonly VisibilityCategory[] = [
  "meshes",
  "surfaces",
  "solids",
  "planes",
  "cylinders",
  "cones",
  "spheres",
  "primitives",
];

/** Cancellation remains with the gesture/dialog that owns it, including while busy. */
export const LOCAL_SHORTCUT_REGISTRY = {
  cancel: { chord: "Escape", label: "Cancel active gesture / close dialog" },
} as const;

export function matchesLocalShortcut(
  event: ShortcutKeyEvent,
  id: keyof typeof LOCAL_SHORTCUT_REGISTRY,
): boolean {
  return matchesShortcutBinding(event, LOCAL_SHORTCUT_REGISTRY[id].chord);
}
