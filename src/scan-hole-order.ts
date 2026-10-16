/** Presentation order uses the boundary length displayed in the hole list.
 * Keep underlying topology indices intact for picking, filling and MCP. */
export function holeListOrder(
  boundaries: readonly { closed: boolean; length: number }[],
): number[] {
  return boundaries
    .flatMap((boundary, index) => (boundary.closed ? [index] : []))
    .sort((a, b) => boundaries[b].length - boundaries[a].length || a - b);
}
