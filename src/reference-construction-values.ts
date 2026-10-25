/** Precise millimeter values. Derived display buffers are never stored here. */
export type ReferenceVector = readonly [number, number, number];
export type ReferencePointGeometry = {
  readonly kind: "point";
  readonly position: ReferenceVector;
};
export type ReferenceLineGeometry = {
  readonly kind: "line";
  readonly start: ReferenceVector;
  readonly direction: ReferenceVector;
  readonly length: number;
};
export type ReferenceGeometry = ReferencePointGeometry | ReferenceLineGeometry;

/** Version 1 stores XYZ or start XYZ, direction XYZ, length as little-endian f64. */
export type EncodedReferenceGeometry = {
  version: 1;
  kind: ReferenceGeometry["kind"];
  bits: string;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid reference geometry record.");
  return value as Record<string, unknown>;
}

function vector(value: unknown): ReferenceVector {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1]) ||
    !Number.isFinite(value[2])
  )
    throw new Error("Reference coordinates require three finite numbers.");
  return [value[0], value[1], value[2]];
}

/** Validate and detach without normalization, quantization or signed-zero loss. */
export function copyReferenceGeometry(input: unknown): ReferenceGeometry {
  const value = record(input);
  if (value.kind === "point")
    return { kind: "point", position: vector(value.position) };
  if (value.kind !== "line")
    throw new Error("Invalid reference geometry kind.");
  if (
    typeof value.length !== "number" ||
    !Number.isFinite(value.length) ||
    value.length < 0
  )
    throw new Error("Reference line length must be finite and nonnegative.");
  const line: ReferenceLineGeometry = {
    kind: "line",
    start: vector(value.start),
    direction: vector(value.direction),
    length: value.length,
  };
  referenceLineEnd(line);
  return line;
}

/** Reconstruct the endpoint with the native stored-line arithmetic order. */
export function referenceLineEnd(line: ReferenceLineGeometry): ReferenceVector {
  const end: ReferenceVector = [
    line.start[0] + line.direction[0] * line.length,
    line.start[1] + line.direction[1] * line.length,
    line.start[2] + line.direction[2] * line.length,
  ];
  if (!end.every(Number.isFinite))
    throw new Error("Reference line endpoint overflow.");
  return end;
}

export function encodeReferenceGeometry(
  input: ReferenceGeometry,
): EncodedReferenceGeometry {
  const geometry = copyReferenceGeometry(input);
  const values =
    geometry.kind === "point"
      ? geometry.position
      : [...geometry.start, ...geometry.direction, geometry.length];
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat64(index * 8, value, true));
  return {
    version: 1,
    kind: geometry.kind,
    bits: Array.from(bytes, (value) =>
      value.toString(16).padStart(2, "0"),
    ).join(""),
  };
}

export function decodeReferenceGeometry(input: unknown): ReferenceGeometry {
  const value = record(input);
  const count = value.kind === "point" ? 3 : value.kind === "line" ? 7 : 0;
  if (
    value.version !== 1 ||
    !count ||
    typeof value.bits !== "string" ||
    value.bits.length !== count * 16 ||
    !/^[0-9a-f]+$/.test(value.bits)
  )
    throw new Error("Invalid reference geometry encoding.");
  const bytes = Uint8Array.from(value.bits.match(/../g)!, (byte) =>
    parseInt(byte, 16),
  );
  const view = new DataView(bytes.buffer);
  const values = Array.from({ length: count }, (_, index) =>
    view.getFloat64(index * 8, true),
  );
  return copyReferenceGeometry(
    value.kind === "point"
      ? { kind: "point", position: values }
      : {
          kind: "line",
          start: values.slice(0, 3),
          direction: values.slice(3, 6),
          length: values[6],
        },
  );
}
