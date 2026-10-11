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

/** OrbitControls swaps ROTATE to pan with Ctrl/Meta; DOLLY ignores modifiers. */
export function cameraMouseButtons(
  meshEdit: boolean,
  modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey?: boolean },
) {
  const navigation =
    middleMouseAction(modifiers) === "zoom" ? MOUSE.DOLLY : MOUSE.ROTATE;
  return {
    LEFT: meshEdit ? null : navigation,
    MIDDLE: navigation,
    RIGHT: null,
  };
}
