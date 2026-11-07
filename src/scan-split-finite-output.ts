/** Expand connected finite-refinement groups without classifying their native meaning. */
export function expandFiniteGroups(
  source: Float32Array,
  added: Float32Array,
  triangles: Uint32Array,
  groups: Uint32Array,
  options: {
    signal?: AbortSignal;
    maxTypedBytes?: number;
    maxWork?: number;
    check?: () => void;
  } = {},
): { group: number; positions: Float32Array }[] {
  if (
    source.length % 3 ||
    added.length % 3 ||
    triangles.length % 3 ||
    groups.length !== triangles.length / 3
  )
    throw new Error("Finite output geometry is incomplete.");
  const bytes = triangles.length * 3 * Float32Array.BYTES_PER_ELEMENT;
  const allowance = options.maxTypedBytes ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(allowance) || allowance < 0 || bytes > allowance)
    throw new Error("Finite output typed memory budget exceeded.");
  const limit = options.maxWork ?? 2_000_000 + triangles.length * 8;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Finite output work budget is invalid.");
  let work = 0;
  const tick = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    options.check?.();
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    if (++work > limit) throw new Error("Finite output work budget exceeded.");
  };
  tick();
  const sourceCount = source.length / 3;
  const vertexCount = sourceCount + added.length / 3;
  const counts = new Map<number, number>();
  for (let face = 0; face < groups.length; face++) {
    tick();
    const group = groups[face];
    if (group >= groups.length)
      throw new Error("Finite output group is invalid.");
    counts.set(group, (counts.get(group) ?? 0) + 1);
    for (let corner = 0; corner < 3; corner++) {
      tick();
      const id = triangles[face * 3 + corner];
      if (id >= vertexCount)
        throw new Error("Finite output vertex index is invalid.");
      const values = id < sourceCount ? source : added;
      const offset = (id < sourceCount ? id : id - sourceCount) * 3;
      for (let axis = 0; axis < 3; axis++)
        if (!Number.isFinite(values[offset + axis]))
          throw new Error("Finite output coordinates must be finite.");
    }
  }
  const output = new Map<
    number,
    { group: number; positions: Float32Array; offset: number }
  >();
  for (const [group, count] of counts) {
    tick();
    output.set(group, {
      group,
      positions: new Float32Array(count * 9),
      offset: 0,
    });
  }
  for (let face = 0; face < groups.length; face++) {
    tick();
    const item = output.get(groups[face])!;
    for (let corner = 0; corner < 3; corner++) {
      tick();
      const id = triangles[face * 3 + corner];
      const values = id < sourceCount ? source : added;
      const offset = (id < sourceCount ? id : id - sourceCount) * 3;
      item.positions[item.offset++] = values[offset];
      item.positions[item.offset++] = values[offset + 1];
      item.positions[item.offset++] = values[offset + 2];
    }
  }
  tick();
  return [...output.values()].map(({ group, positions }) => ({
    group,
    positions,
  }));
}
