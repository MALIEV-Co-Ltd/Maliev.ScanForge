/** Allow one CSS pixel of tolerance for fractional scroll positions and zoom. */
export function ribbonOverflowEdges(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
) {
  const maximum = Math.max(0, scrollWidth - clientWidth);
  const position = Math.min(maximum, Math.max(0, scrollLeft));
  return { left: position > 1, right: maximum - position > 1 };
}
