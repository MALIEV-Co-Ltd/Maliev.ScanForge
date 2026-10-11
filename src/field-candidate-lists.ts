export interface FieldCandidateList {
  /** The final next slot is the head sentinel; -1 terminates and -2 means inactive. */
  next: Int32Array;
  previous: Int32Array;
  remaining: number;
}

export interface FieldExclusionBits {
  bits: Uint8Array;
  bitCount: number;
}

/** Supplied connection pool or eligible nodes, in the recovered ascending traversal order. */
export function createFieldCandidateList(
  count: number,
  eligible?: Uint8Array,
): FieldCandidateList {
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    count > 2147483647 ||
    (eligible && eligible.length !== count)
  )
    throw new Error("Invalid candidate-list dimensions.");
  const next = new Int32Array(count + 1).fill(-2);
  const previous = new Int32Array(count).fill(-2);
  let tail = count,
    remaining = 0;
  next[count] = -1;
  for (let id = 0; id < count; id++) {
    if (eligible && eligible[id] > 1)
      throw new Error("Candidate eligibility must contain boolean flags.");
    if (eligible && !eligible[id]) continue;
    next[tail] = id;
    previous[id] = tail;
    next[id] = -1;
    tail = id;
    remaining++;
  }
  return { next, previous, remaining };
}

/** Validates ownership-independent list invariants and returns only active IDs. */
export function fieldCandidateIds(list: FieldCandidateList): Uint32Array {
  const count = list.previous.length;
  if (
    list.next.length !== count + 1 ||
    !Number.isInteger(list.remaining) ||
    list.remaining < 0 ||
    list.remaining > count
  )
    throw new Error("Invalid candidate-list shape.");
  const visited = new Set<number>();
  const ids: number[] = [];
  let previous = count,
    current = list.next[count];
  while (current !== -1) {
    if (
      current < 0 ||
      current >= count ||
      visited.has(current) ||
      list.previous[current] !== previous
    )
      throw new Error("Candidate-list links are inconsistent.");
    visited.add(current);
    ids.push(current);
    previous = current;
    current = list.next[current];
  }
  if (ids.length !== list.remaining)
    throw new Error("Candidate-list count is inconsistent.");
  for (let id = 0; id < count; id++)
    if (!visited.has(id) && (list.next[id] !== -2 || list.previous[id] !== -2))
      throw new Error("Inactive candidate-list links are inconsistent.");
  return Uint32Array.from(ids);
}

/** Recovered unlink operation; original arrays stay owned by their caller. */
export function removeFieldCandidates(
  list: FieldCandidateList,
  ids: Uint32Array,
): FieldCandidateList {
  fieldCandidateIds(list);
  const output = {
    next: list.next.slice(),
    previous: list.previous.slice(),
    remaining: list.remaining,
  };
  for (const id of ids) {
    if (id >= output.previous.length || output.previous[id] === -2)
      throw new Error("Candidate removal requires a unique active ID.");
    const previous = output.previous[id],
      next = output.next[id];
    output.next[previous] = next;
    if (next !== -1) output.previous[next] = previous;
    output.next[id] = -2;
    output.previous[id] = -2;
    output.remaining--;
  }
  return output;
}

/** Native node eligibility consumes supplied float strengths and two exclusion bitsets. */
export function prepareFieldCandidateLists(
  connectionCount: number,
  strengths: Float32Array,
  exclusionA?: FieldExclusionBits,
  exclusionB?: FieldExclusionBits,
): { connections: FieldCandidateList; nodes: FieldCandidateList } {
  for (const mask of [exclusionA, exclusionB])
    if (
      mask &&
      (!Number.isInteger(mask.bitCount) ||
        mask.bitCount < 0 ||
        mask.bitCount > mask.bits.length * 8)
    )
      throw new Error("Candidate exclusion bitsets require valid bit counts.");
  const excluded = (mask: FieldExclusionBits | undefined, id: number) =>
    mask &&
    id < mask.bitCount &&
    (mask.bits[Math.floor(id / 8)] & (1 << (id % 8))) !== 0;
  const eligible = new Uint8Array(strengths.length);
  for (let id = 0; id < strengths.length; id++) {
    if (!Number.isFinite(strengths[id]))
      throw new Error("Candidate strengths must be finite.");
    eligible[id] = Number(
      !excluded(exclusionA, id) &&
        !excluded(exclusionB, id) &&
        strengths[id] > Math.fround(0.000002),
    );
  }
  return {
    connections: createFieldCandidateList(connectionCount),
    nodes: createFieldCandidateList(strengths.length, eligible),
  };
}
