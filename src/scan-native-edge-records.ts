/** Private directed-edge lookup. Callers validate geometry before linking. */
export interface NativeAlignmentEdgeRecords {
  get(from: number, to: number): number | undefined;
  set(from: number, to: number, value: number): void;
  remember(from: number, to: number, value: number): void;
  readonly size: number;
  readonly kind: "compact" | "map";
  /** Live table storage only; not total process memory. Unknown for Map. */
  readonly byteLength: number | undefined;
}

function hash(from: number, to: number) {
  let value =
    Math.imul(from ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(to, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

/** These buffers are created and owned exclusively by this directory. Detaching
 * retired storage never touches authored geometry. Older runtimes use GC. */
function release(buffer: ArrayBufferLike) {
  const owned = buffer as ArrayBuffer & {
    transfer?: (size: number) => ArrayBuffer;
  };
  try {
    owned.transfer?.(0);
  } catch {
    /* Collection remains the fallback. */
  }
}

export function createNativeAlignmentEdgeRecords(
  vertexCount: number,
  edgeSlots: number,
  options: { signal?: AbortSignal; expectedEntries?: number } = {},
): NativeAlignmentEdgeRecords {
  if (
    !Number.isSafeInteger(vertexCount) ||
    vertexCount < 0 ||
    !Number.isSafeInteger(edgeSlots) ||
    edgeSlots < 0
  )
    throw Error("Invalid directed-edge directory dimensions.");
  if (
    options.expectedEntries !== undefined &&
    (!Number.isSafeInteger(options.expectedEntries) ||
      options.expectedEntries < 0 ||
      options.expectedEntries > edgeSlots)
  )
    throw Error("Invalid directed-edge directory reserve.");
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  const validate = (from: number, to: number, value: number) => {
    if (
      !Number.isSafeInteger(from) ||
      from < 0 ||
      from >= vertexCount ||
      !Number.isSafeInteger(to) ||
      to < 0 ||
      to >= vertexCount ||
      !Number.isSafeInteger(value) ||
      value >= edgeSlots ||
      value < -edgeSlots
    )
      throw Error("Invalid directed-edge record.");
  };
  check();
  if (vertexCount > 0x100000000 || edgeSlots > 0x7fffffff) {
    const records = new Map<string, number>();
    return {
      kind: "map",
      byteLength: undefined,
      get size() {
        return records.size;
      },
      get: (from, to) => records.get(`${from}:${to}`),
      set(from, to, value) {
        validate(from, to, value);
        records.set(`${from}:${to}`, value);
      },
      remember(from, to, value) {
        validate(from, to, value);
        const key = `${from}:${to}`;
        if (!records.has(key)) records.set(key, value);
      },
    };
  }
  let capacity = 8;
  // Without observed topology, cap the hint so unused vertices cannot reserve a
  // large table. An explicit hint comes from vertices referenced by faces.
  const hint =
    options.expectedEntries === undefined
      ? Math.min(
          65536,
          Math.ceil(
            (Math.min(edgeSlots / 2, vertexCount * vertexCount) * 10) / 7,
          ),
        )
      : Math.ceil((options.expectedEntries * 10) / 7);
  if (hint > 0x40000000)
    throw RangeError("Directed-edge directory capacity exceeded.");
  while (capacity < hint) capacity *= 2;
  let keys = new Uint32Array(capacity * 2),
    values = new Int32Array(capacity),
    count = 0;
  const locate = (from: number, to: number) => {
    const mask = values.length - 1;
    let slot = hash(from, to) & mask;
    while (
      values[slot] &&
      (keys[slot * 2] !== from || keys[slot * 2 + 1] !== to)
    )
      slot = (slot + 1) & mask;
    return slot;
  };
  const grow = () => {
    check();
    if (values.length >= 0x40000000)
      throw RangeError("Directed-edge directory capacity exceeded.");
    const nextValues = new Int32Array(values.length * 2);
    const nextKeys = new Uint32Array(nextValues.length * 2);
    try {
      const mask = nextValues.length - 1;
      for (let old = 0; old < values.length; old++) {
        if (old % 4096 === 0) check();
        if (!values[old]) continue;
        const from = keys[old * 2],
          to = keys[old * 2 + 1];
        let slot = hash(from, to) & mask;
        while (nextValues[slot]) slot = (slot + 1) & mask;
        nextKeys[slot * 2] = from;
        nextKeys[slot * 2 + 1] = to;
        nextValues[slot] = values[old];
      }
    } catch (error) {
      release(nextKeys.buffer);
      release(nextValues.buffer);
      throw error;
    }
    const oldKeys = keys,
      oldValues = values;
    keys = nextKeys;
    values = nextValues;
    release(oldKeys.buffer);
    release(oldValues.buffer);
  };
  const put = (from: number, to: number, value: number, firstOnly: boolean) => {
    validate(from, to, value);
    let slot = locate(from, to);
    if (values[slot]) {
      if (!firstOnly) values[slot] = value >= 0 ? value + 1 : value;
      return;
    }
    if ((count + 1) * 10 > values.length * 7) {
      grow();
      slot = locate(from, to);
    }
    keys[slot * 2] = from;
    keys[slot * 2 + 1] = to;
    values[slot] = value >= 0 ? value + 1 : value;
    count++;
  };
  return {
    kind: "compact",
    get size() {
      return count;
    },
    get byteLength() {
      return keys.byteLength + values.byteLength;
    },
    get(from, to) {
      const value = values[locate(from, to)];
      return value ? (value > 0 ? value - 1 : value) : undefined;
    },
    set: (from, to, value) => put(from, to, value, false),
    remember: (from, to, value) => put(from, to, value, true),
  };
}
