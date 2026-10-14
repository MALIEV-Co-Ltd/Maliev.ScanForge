import {
  availableShortcutBinding,
  matchesShortcutBinding,
  modeShortcutBindings,
  shortcutChord,
  type ShortcutPlatform,
} from "./shortcut-registry";
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
  | "toggle-selected-visibility"
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
  code?: string;
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
  platform?: ShortcutPlatform;
  /** All registered host commands, including temporarily unavailable commands. */
  supportedActions?: ReadonlySet<ShortcutActionId>;
  visibilityCategories?: readonly VisibilityCategory[];
  allowConfiguredRotation?: boolean;
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
  const entry = modeShortcutBindings(context).find((binding) =>
    matchesShortcutBinding(
      event,
      shortcutChord(binding, context.platform),
      context.platform,
    ),
  );
  if (!entry) return null;
  if (!availableShortcutBinding(entry, context)) {
    const fallback =
      entry.action.id === "undo-selection"
        ? "undo-model"
        : entry.action.id === "redo-selection"
          ? "redo-model"
          : null;
    if (fallback && context.availableActions.has(fallback))
      return { id: fallback };
    return null;
  }
  if (entry.action.id === "rotate-view" && context.nativeControl) return null;
  return entry.action;
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

/** Persistently mounted, hidden settings must not suppress workspace shortcuts. */
export function hasVisibleKeyboardModal(
  root: Pick<Document, "querySelectorAll"> = document,
): boolean {
  return Array.from(
    root.querySelectorAll('[aria-modal="true"],dialog[open]'),
  ).some(
    (element) =>
      element.getClientRects().length > 0 &&
      !element.closest('[hidden],[inert],[aria-hidden="true"]'),
  );
}
