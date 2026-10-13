/** Optimized STL vertex table recovered from 0x1408c6d40/0x1408c9d80.
 * Kept separate from the fallback facet insertion tolerance.
 */
export type NativeStlKey = readonly [bigint, bigint, bigint];
const SIGN_BIT = 1n << 63n;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

/** Float32 coordinate -> original UCRT llround(double(coordinate) * 1e6). */
export function nativeStlCoordinateKey(coordinate: number): bigint {
  const scaled = Math.fround(coordinate) * 1e6;
  const absolute = Math.abs(scaled);
  const integer = Math.trunc(absolute);
  const rounded = integer + (absolute - integer >= 0.5 ? 1 : 0);
  // The captured Windows CRT returns zero outside this range, including NaN.
  if (!Number.isFinite(rounded) || rounded > 2 ** 63) return 0n;
  if (rounded === 2 ** 63) return -SIGN_BIT;
  return BigInt(rounded) * (scaled < 0 ? -1n : 1n);
}

function coordinateHash(key: bigint): bigint {
  let bytes = BigInt.asUintN(64, key);
  let hash = FNV_OFFSET;
  for (let i = 0; i < 8; i++) {
    hash = BigInt.asUintN(64, (hash ^ (bytes & 255n)) * FNV_PRIME);
    bytes >>= 8n;
  }
  return hash;
}

/** Original hash before applying the table's power-of-two bucket mask. */
export function nativeStlVertexHash(key: NativeStlKey): bigint {
  return BigInt.asUintN(
    64,
    coordinateHash(key[0]) ^
      (coordinateHash(key[1]) << 1n) ^
      (coordinateHash(key[2]) << 2n),
  );
}

const keyBytes = new DataView(new ArrayBuffer(8));
function coordinateBucketHash(key: bigint) {
  keyBytes.setBigInt64(0, BigInt.asIntN(64, key), true);
  let hash = 0x84222325;
  for (let i = 0; i < 8; i++)
    hash = Math.imul(hash ^ keyBytes.getUint8(i), 0x1b3);
  return hash;
}

/** Exact low 32 hash bits; table masks do not need the discarded high bits. */
export function nativeStlVertexBucketHash(key: NativeStlKey) {
  return (
    (coordinateBucketHash(key[0]) ^
      (coordinateBucketHash(key[1]) << 1) ^
      (coordinateBucketHash(key[2]) << 2)) >>>
    0
  );
}

interface VertexEntry {
  key: NativeStlKey;
  value: number;
  hash: number;
  previous?: VertexEntry;
  next?: VertexEntry;
}

/** Native iteration order, rather than JavaScript Map insertion order.
 * Equal keys retain the first vertex; collisions prepend within their bucket.
 */
export class NativeStlVertexTable {
  private readonly lookup = new Map<string, VertexEntry>();
  private buckets = new Map<number, VertexEntry>();
  private first?: VertexEntry;
  private last?: VertexEntry;
  private count = 8;

  get size() {
    return this.lookup.size;
  }

  get bucketCount() {
    return this.count;
  }

  insert(key: NativeStlKey, value: number) {
    const identity = key.join(",");
    const existing = this.lookup.get(identity);
    if (existing) return { inserted: false, value: existing.value };
    const entry: VertexEntry = {
      key: [key[0], key[1], key[2]],
      value,
      hash: nativeStlVertexBucketHash(key),
    };
    this.lookup.set(identity, entry);
    this.link(entry);
    if (Math.fround(Math.fround(this.size) / Math.fround(this.count)) > 1) {
      this.count *= this.count < 512 ? 8 : 2;
      const previous = this.first;
      this.first = this.last = undefined;
      this.buckets = new Map();
      for (let node = previous; node;) {
        const next = node.next;
        node.previous = node.next = undefined;
        this.link(node);
        node = next;
      }
    }
    return { inserted: true, value };
  }

  private link(entry: VertexEntry) {
    const bucket = (entry.hash & (this.count - 1)) >>> 0;
    const first = this.buckets.get(bucket);
    if (first) {
      entry.next = first;
      entry.previous = first.previous;
      if (first.previous) first.previous.next = entry;
      else this.first = entry;
      first.previous = entry;
    } else {
      entry.previous = this.last;
      if (this.last) this.last.next = entry;
      else this.first = entry;
      this.last = entry;
    }
    this.buckets.set(bucket, entry);
  }

  *entries(): Generator<{ key: NativeStlKey; value: number }> {
    for (let entry = this.first; entry; entry = entry.next)
      yield { key: entry.key, value: entry.value };
  }
}
