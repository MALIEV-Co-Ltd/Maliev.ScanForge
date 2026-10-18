export function middleMouseAction(modifiers: {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey?: boolean;
}): "rotate" | "pan" | "zoom" {
  if (modifiers.shiftKey) return "zoom";
  return modifiers.ctrlKey || modifiers.metaKey ? "pan" : "rotate";
}
export function subtractSelection(explicit: boolean, altKey: boolean): boolean {
  return explicit || altKey;
}
import { MOUSE } from "three";

/** Explicit mappings also preserve modifiers with unrestricted trackball orbit. */
export function cameraMouseButtons(
  meshEdit: boolean,
  modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey?: boolean },
) {
  const action = middleMouseAction(modifiers);
  const navigation =
    action === "zoom"
      ? MOUSE.DOLLY
      : action === "pan"
        ? MOUSE.PAN
        : MOUSE.ROTATE;
  return {
    LEFT: meshEdit ? null : navigation,
    MIDDLE: navigation,
    RIGHT: MOUSE.PAN,
  };
}
