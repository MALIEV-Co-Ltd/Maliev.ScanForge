import type { ShortcutContext } from "../keyboard-shortcuts";
import {
  SHORTCUT_REGISTRY,
  SHORTCUT_MODE_LABELS,
  availableShortcutBinding,
  modeShortcutBindings,
  shortcutKeys,
  shortcutChord,
  supportedShortcutBinding,
  LOCAL_SHORTCUT_REGISTRY,
} from "../shortcut-registry";

/** The complete implemented catalog, with inactive tools and unavailable commands marked. */
export function shortcutReference(context: ShortcutContext) {
  const active = new Set(modeShortcutBindings(context));
  const supported = context.supportedActions ?? context.availableActions;
  const commands = SHORTCUT_REGISTRY.filter((entry) => {
    if (
      !supported.has(entry.action.id) ||
      !supportedShortcutBinding(entry, context)
    )
      return false;
    // Undo/redo is one command with the current editor's transaction owner.
    if (/^(undo|redo)-/.test(entry.action.id) && !active.has(entry))
      return false;
    return true;
  }).map((entry) => ({
    keys: shortcutKeys(
      shortcutChord(entry, context.platform),
      context.platform,
    ),
    label: entry.label,
    scope: entry.modes?.map((mode) => SHORTCUT_MODE_LABELS[mode]).join(" / "),
    enabled:
      active.has(entry) &&
      availableShortcutBinding(entry, context) &&
      !context.busy &&
      !context.modalOpen,
    active: active.has(entry),
  }));
  return [
    ...commands,
    ...Object.values(LOCAL_SHORTCUT_REGISTRY).map((entry) => ({
      keys: shortcutKeys(entry.chord, context.platform),
      label: entry.label,
      scope: "Active gesture / dialog",
      enabled: true,
      active: true,
    })),
  ];
}
