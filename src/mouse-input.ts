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
