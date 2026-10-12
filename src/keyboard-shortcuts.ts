/** Shipped shortcut catalog recovered from the installed localization resource.
 * Dispatch precedence and unsupported commands are explicitly controlled by the host.
 */
export type ShortcutMode =
  "main" | "selection" | "sketch" | "freeform" | "primitive-fit";
export type ShortcutActionId =
  | "new"
  | "open"
  | "save"
  | "undo-model"
  | "redo-model"
  | "undo-selection"
  | "redo-selection"
  | "undo-sketch"
  | "redo-sketch"
  | "fit-view"
  | "view-top"
  | "view-bottom"
  | "view-left"
  | "view-right"
  | "view-front"
  | "view-back"
  | "view-isometric"
  | "rotate-view"
  | "hide-selected"
  | "hide-meshes"
  | "new-sketch"
  | "compare"
  | "trim"
  | "fillet"
  | "selection-wand"
  | "selection-brush"
  | "selection-through"
  | "clear-selection"
  | "toggle-visibility"
  | "sketch-line"
  | "sketch-circle"
  | "sketch-arc"
  | "sketch-dimensions"
  | "sketch-trim"
  | "sketch-mirror"
  | "sketch-offset"
  | "sketch-join"
  | "freeform-split"
  | "freeform-smooth"
  | "freeform-bridge"
  | "freeform-refine"
  | "fit-plane"
  | "fit-cylinder"
  | "fit-cone"
  | "fit-sphere"
  | "fit-line";
export type VisibilityCategory =
  | "meshes"
  | "point-clouds"
  | "surfaces"
  | "solids"
  | "sketches"
  | "references"
  | "planes"
  | "cylinders"
  | "cones"
  | "spheres"
  | "primitives";
export interface ShortcutAction {
  id: ShortcutActionId;
  category?: VisibilityCategory;
  direction?: "left" | "right" | "up" | "down";
  /** Ctrl+arrow uses the host's configured navigation angle; bare arrows use 90 degrees. */
  configuredAngle?: boolean;
}
export interface ShortcutKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}
export interface ShortcutContext {
  mode: ShortcutMode;
  busy?: boolean;
  textEditing?: boolean;
  modalOpen?: boolean;
  /** Preserve arrow keys in native controls and menus. */
  nativeControl?: boolean;
  /** Never consume a chord for a command that the host cannot currently execute. */
  availableActions: ReadonlySet<ShortcutActionId>;
  /** Existing ScanForge additions B, U and Ctrl+Shift+Z are opt-in, not native evidence. */
  allowExtensions?: boolean;
}
const views: Record<string, ShortcutActionId> = {
  a: "fit-view",
  t: "view-top",
  m: "view-bottom",
  l: "view-left",
  r: "view-right",
  f: "view-front",
  k: "view-back",
  i: "view-isometric",
};
const sketch: Record<string, ShortcutActionId> = {
  l: "sketch-line",
  c: "sketch-circle",
  r: "sketch-arc",
  d: "sketch-dimensions",
  t: "sketch-trim",
  m: "sketch-mirror",
  o: "sketch-offset",
  j: "sketch-join",
};
const freeform: Record<string, ShortcutActionId> = {
  s: "freeform-split",
  q: "freeform-smooth",
  d: "freeform-bridge",
};
const primitive: Record<string, ShortcutActionId> = {
  p: "fit-plane",
  c: "fit-cylinder",
  o: "fit-cone",
  e: "fit-sphere",
};
const categories: Record<string, VisibilityCategory> = {
  "1": "meshes",
  "2": "point-clouds",
  "3": "surfaces",
  "4": "solids",
  "5": "sketches",
  "6": "references",
  "7": "planes",
  "8": "cylinders",
  "9": "cones",
  "0": "spheres",
  p: "primitives",
};

export function resolveKeyboardShortcut(
  event: ShortcutKeyEvent,
  context: ShortcutContext,
): ShortcutAction | null {
  if (
    context.busy ||
    context.textEditing ||
    context.modalOpen ||
    event.isComposing ||
    event.defaultPrevented ||
    event.repeat ||
    event.altKey
  )
    return null;
  // Meta chords belong to the browser/platform: the shipped Windows catalog specifies Ctrl.
  if (event.metaKey) return null;
  const key = event.key.toLowerCase(),
    command = !!event.ctrlKey,
    shifted = !!event.shiftKey;
  let action: ShortcutAction | undefined;
  if (key.startsWith("arrow") && !shifted && !context.nativeControl) {
    const direction = key.slice(5);
    if (["left", "right", "up", "down"].includes(direction))
      action = {
        id: "rotate-view",
        direction: direction as ShortcutAction["direction"],
        configuredAngle: command,
      };
  } else if (command && (key === "z" || key === "y")) {
    if (!shifted || (context.allowExtensions && key === "z")) {
      const redo = key === "y" || shifted;
      const domain =
        context.mode === "sketch"
          ? "sketch"
          : context.mode === "selection"
            ? "selection"
            : "model";
      action = {
        id: `${redo ? "redo" : "undo"}-${domain}` as ShortcutActionId,
      };
    }
  } else if (command && !shifted) {
    const global: Record<string, ShortcutActionId> = {
      n: "new",
      o: "open",
      s: "save",
      h: "hide-meshes",
      q: "clear-selection",
    };
    if (context.mode === "freeform" && key === "r")
      action = { id: "freeform-refine" };
    else if (global[key]) action = { id: global[key] };
    else if (context.mode === "main" || context.mode === "selection") {
      if (categories[key])
        action = { id: "toggle-visibility", category: categories[key] };
      else if (key === "t") action = { id: "trim" };
      else if (key === "f") action = { id: "fillet" };
    }
  } else if (!command) {
    if (context.mode === "primitive-fit" && shifted && key === "l")
      action = { id: "fit-line" };
    else if (!shifted) {
      // A mode-specific chord reserves the key, even if its action is unavailable.
      const local =
        context.mode === "sketch"
          ? sketch[key]
          : context.mode === "freeform"
            ? freeform[key]
            : context.mode === "primitive-fit"
              ? primitive[key]
              : undefined;
      if (local) action = { id: local };
      else if (views[key]) action = { id: views[key] };
      else if (context.mode === "main" || context.mode === "selection") {
        const main: Record<string, ShortcutActionId> = {
          h: "hide-selected",
          s: "new-sketch",
          d: "compare",
          w: "selection-wand",
        };
        if (main[key]) action = { id: main[key] };
        else if (context.mode === "selection" && context.allowExtensions) {
          if (key === "b") action = { id: "selection-brush" };
          if (key === "u") action = { id: "selection-through" };
        }
      }
    }
  }
  return action && context.availableActions.has(action.id) ? action : null;
}

/** The host passes this result to ShortcutContext.textEditing/nativeControl. */
export function keyboardTargetContext(target: EventTarget | null): {
  textEditing: boolean;
  nativeControl: boolean;
} {
  const element = target as Element | null;
  if (!element || typeof element.closest !== "function")
    return { textEditing: false, nativeControl: false };
  return {
    textEditing: !!element.closest(
      'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
    ),
    nativeControl: !!element.closest(
      'button,a,input,textarea,select,[role="menu"],[role="tablist"],[role="listbox"]',
    ),
  };
}
