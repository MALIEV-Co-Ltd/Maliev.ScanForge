type Incidence = {
  edge: [number, number];
  faces: number[];
  groups: number[];
  kind: "boundary" | "separating" | "nonseparating";
};
const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** Describe cut-edge incidence using the supplied groups, including any selection partition.
 * These labels alone do not prove that a cut caused separation or determine signed classification.
 */
export function analyzeFiniteCutIncidence(
  triangles: Uint32Array,
  cuts: Uint32Array,
  groups: Uint32Array,
  options: { signal?: AbortSignal; maxWork?: number; check?: () => void } = {},
): Incidence[] {
  if (
    triangles.length % 3 ||
    cuts.length % 2 ||
    groups.length !== triangles.length / 3
  )
    throw new Error("Finite cut incidence indices are invalid.");
  const limit =
    options.maxWork ?? 2_000_000 + triangles.length * 2 + cuts.length;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Finite incidence work budget is invalid.");
  let work = 0;
  const tick = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    options.check?.();
    if (++work > limit)
      throw new Error("Finite incidence work budget exceeded.");
  };
  tick();
  const lookup = new Map<string, Incidence>();
  for (let i = 0; i < cuts.length; i += 2) {
    tick();
    const a = cuts[i],
      b = cuts[i + 1],
      id = key(a, b);
    if (a === b) throw new Error("Finite cut edge is invalid.");
    if (lookup.has(id)) continue;
    lookup.set(id, {
      edge: [Math.min(a, b), Math.max(a, b)],
      faces: [],
      groups: [],
      kind: "boundary",
    });
  }
  for (let f = 0; f < groups.length; f++) {
    tick();
    const offset = f * 3;
    if (
      groups[f] >= groups.length ||
      triangles[offset] === triangles[offset + 1] ||
      triangles[offset + 1] === triangles[offset + 2] ||
      triangles[offset + 2] === triangles[offset]
    )
      throw new Error("Finite cut incidence face is invalid.");
    for (let side = 0; side < 3; side++) {
      tick();
      const item = lookup.get(
        key(triangles[offset + side], triangles[offset + ((side + 1) % 3)]),
      );
      if (!item) continue;
      item.faces.push(f);
      item.groups.push(groups[f]);
      if (item.faces.length > 2)
        throw new Error("Finite cut edge is non-manifold.");
    }
  }
  for (const item of lookup.values()) {
    tick();
    if (!item.faces.length) throw new Error("Finite cut edge is missing.");
    if (item.faces.length === 2)
      item.kind =
        item.groups[0] === item.groups[1] ? "nonseparating" : "separating";
  }
  return [...lookup.values()];
}
