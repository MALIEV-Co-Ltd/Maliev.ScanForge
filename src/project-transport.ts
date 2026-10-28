import { yieldScanTask } from "./scan-task";
const CHUNK = 65536;
export interface ProjectTransport {
  kind: "scanforge-numeric-transport-v1";
  graph: unknown;
  numbers: { ref: object; values: Float64Array }[];
}
export function containsLargeNumericArrays(
  value: unknown,
  seen = new Set<object>(),
): boolean {
  if (
    !value ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value) ||
    seen.has(value)
  )
    return false;
  seen.add(value);
  if (
    Array.isArray(value) &&
    value.length >= CHUNK &&
    typeof value[0] === "number"
  )
    return true;
  return Object.values(value).some((v) => containsLargeNumericArrays(v, seen));
}
/** Only new numeric staging buffers transfer on the UI path. Worker-owned decoded
 * buffers may additionally transfer back to the UI without a geometry copy. */
export async function packProjectTransport(
  value: unknown,
  options: {
    ownedTypedArrays?: boolean;
    check?: () => void;
    cooperative?: boolean;
  } = {},
) {
  const memo = new Map<object, unknown>(),
    numbers: ProjectTransport["numbers"] = [],
    buffers = new Set<ArrayBuffer>();
  const check = options.check ?? (() => {});
  const visit = async (v: any): Promise<any> => {
    check();
    if (!v || typeof v !== "object") return v;
    if (memo.has(v)) return memo.get(v);
    if (ArrayBuffer.isView(v)) {
      if (options.ownedTypedArrays && v.buffer instanceof ArrayBuffer)
        buffers.add(v.buffer);
      return v;
    }
    if (
      v instanceof ArrayBuffer ||
      (typeof SharedArrayBuffer !== "undefined" &&
        v instanceof SharedArrayBuffer)
    ) {
      if (options.ownedTypedArrays && v instanceof ArrayBuffer) buffers.add(v);
      return v;
    }
    if (Array.isArray(v) && v.length >= CHUNK && typeof v[0] === "number") {
      const ref = {},
        values = new Float64Array(v.length);
      memo.set(v, ref);
      for (let first = 0; first < v.length; first += CHUNK) {
        check();
        for (let i = first; i < Math.min(v.length, first + CHUNK); i++) {
          if (typeof v[i] !== "number")
            throw new Error("Numeric project buffers must contain numbers.");
          values[i] = v[i];
        }
        if (options.cooperative !== false && first + CHUNK < v.length)
          await yieldScanTask();
      }
      check();
      numbers.push({ ref, values });
      buffers.add(values.buffer);
      return ref;
    }
    const out: any = Array.isArray(v) ? new Array(v.length) : {};
    memo.set(v, out);
    for (const key of Object.keys(v))
      Object.defineProperty(out, key, {
        value: await visit(v[key]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    return out;
  };
  const graph = await visit(value);
  check();
  return {
    packet: {
      kind: "scanforge-numeric-transport-v1",
      graph,
      numbers,
    } as ProjectTransport,
    transfers: [...buffers],
  };
}
export async function unpackProjectTransport<T = unknown>(
  packet: ProjectTransport,
  options: {
    check?: () => void;
    cooperative?: boolean;
    retainNumericBuffer?: (ref: object, values: Float64Array) => boolean;
  } = {},
): Promise<T> {
  if (
    packet?.kind !== "scanforge-numeric-transport-v1" ||
    !Array.isArray(packet.numbers)
  )
    throw new Error("Invalid numeric project transport.");
  const memo = new Map<object, unknown>(),
    check = options.check ?? (() => {});
  for (const entry of packet.numbers) {
    check();
    if (
      !entry?.ref ||
      typeof entry.ref !== "object" ||
      !(entry.values instanceof Float64Array) ||
      memo.has(entry.ref)
    )
      throw new Error("Invalid numeric project buffer.");
    if (options.retainNumericBuffer?.(entry.ref, entry.values)) {
      memo.set(entry.ref, entry.values);
      continue;
    }
    const values = new Array<number>(entry.values.length);
    for (let first = 0; first < values.length; first += CHUNK) {
      check();
      for (let i = first; i < Math.min(values.length, first + CHUNK); i++)
        values[i] = entry.values[i];
      if (options.cooperative !== false && first + CHUNK < values.length)
        await yieldScanTask();
    }
    memo.set(entry.ref, values);
  }
  const visit = (v: any): any => {
    check();
    if (!v || typeof v !== "object") return v;
    if (memo.has(v)) return memo.get(v);
    if (
      ArrayBuffer.isView(v) ||
      v instanceof ArrayBuffer ||
      (typeof SharedArrayBuffer !== "undefined" &&
        v instanceof SharedArrayBuffer)
    )
      return v;
    const out: any = Array.isArray(v) ? new Array(v.length) : {};
    memo.set(v, out);
    for (const key of Object.keys(v))
      Object.defineProperty(out, key, {
        value: visit(v[key]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    return out;
  };
  return visit(packet.graph) as T;
}
