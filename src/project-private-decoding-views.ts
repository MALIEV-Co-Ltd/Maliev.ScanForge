// These views are created only from private, checksum-verified decoder chunks.
// Transport converts them to ordinary project arrays before publication.
const views = new WeakSet<Float64Array>();

export function markPrivateDecodingView(value: Float64Array): Float64Array {
  views.add(value);
  return value;
}

export function isPrivateDecodingView(value: unknown): value is Float64Array {
  return value instanceof Float64Array && views.has(value);
}
