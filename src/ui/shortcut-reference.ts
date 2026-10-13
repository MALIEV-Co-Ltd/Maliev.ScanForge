import {
  resolveKeyboardShortcut,
  type ShortcutActionId,
  type ShortcutMode,
} from "../keyboard-shortcuts";
const labels: Partial<Record<ShortcutActionId, string>> = {
  new: "New project",
  open: "Open scan or project",
  save: "Save project",
  "fit-view": "Zoom to fit",
  "view-top": "Top view",
  "view-bottom": "Bottom view",
  "view-left": "Left view",
  "view-right": "Right view",
  "view-front": "Front view",
  "view-back": "Back view",
  "view-isometric": "Isometric view",
  "rotate-view": "Rotate view 90Â°",
  "hide-meshes": "Hide meshes",
  "hide-selected": "Hide selected object or triangles",
  "new-sketch": "Create sketch",
  compare: "Compare deviation",
  fillet: "Open CAD fillet tools",
  "selection-wand": "Magic wand",
  "selection-brush": "Filled brush",
  "selection-through": "Toggle see-through selection",
  "clear-selection": "Clear selection",
  "sketch-line": "Draw line",
  "sketch-circle": "Draw circle",
  "sketch-arc": "Draw three-point arc",
  "sketch-dimensions": "Toggle sketch constraints",
  "fit-plane": "Fit plane",
  "fit-cylinder": "Fit cylinder",
  "fit-cone": "Fit cone",
  "fit-sphere": "Fit sphere",
};
/** Only bindings executable by the application host, resolved with its mode precedence. */
export function shortcutReference(
  mode: ShortcutMode,
  hasSelection = false,
  hasCadSelection = false,
) {
  const available = new Set<ShortcutActionId>([
    "new",
    "open",
    "save",
    "fit-view",
    "view-top",
    "view-bottom",
    "view-left",
    "view-right",
    "view-front",
    "view-back",
    "view-isometric",
    "rotate-view",
    "hide-meshes",
    "toggle-visibility",
    `undo-${mode === "sketch" ? "sketch" : mode === "selection" ? "selection" : "model"}`,
    `redo-${mode === "sketch" ? "sketch" : mode === "selection" ? "selection" : "model"}`,
  ]);
  if (hasCadSelection) available.add("fillet");
  if (hasSelection)
    for (const id of [
      "hide-selected",
      "new-sketch",
      "compare",
      "selection-wand",
      "fit-plane",
      "fit-cylinder",
      "fit-cone",
      "fit-sphere",
    ] as const)
      available.add(id);
  if (mode === "selection")
    for (const id of [
      "selection-brush",
      "selection-through",
      "clear-selection",
    ] as const)
      available.add(id);
  if (mode === "sketch")
    for (const id of [
      "sketch-line",
      "sketch-circle",
      "sketch-arc",
      "sketch-dimensions",
    ] as const)
      available.add(id);
  const chords = [
    "Ctrl+N",
    "Ctrl+O",
    "Ctrl+S",
    "Ctrl+Z",
    "Ctrl+Y",
    "Ctrl+Shift+Z",
    "A",
    "T",
    "M",
    "L",
    "R",
    "F",
    "K",
    "I",
    "H",
    "S",
    "D",
    "W",
    "B",
    "U",
    "C",
    "P",
    "O",
    "E",
    "Ctrl+F",
    "Ctrl+H",
    "Ctrl+Q",
    "Ctrl+1",
    "Ctrl+3",
    "Ctrl+4",
    "Ctrl+7",
    "Ctrl+8",
    "Ctrl+9",
    "Ctrl+0",
    "Ctrl+P",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
  ];
  return chords.flatMap((chord) => {
    const keys = chord.split("+");
    const action = resolveKeyboardShortcut(
      {
        key: keys.at(-1)!,
        ctrlKey: keys.includes("Ctrl"),
        shiftKey: keys.includes("Shift"),
      },
      { mode, availableActions: available, allowExtensions: true },
    );
    if (!action) return [];
    const label = action.id.startsWith("undo-")
      ? "Undo"
      : action.id.startsWith("redo-")
        ? "Redo"
        : action.id === "toggle-visibility"
          ? `Toggle ${action.category}`
          : labels[action.id];
    return label ? [{ keys, label }] : [];
  });
}
