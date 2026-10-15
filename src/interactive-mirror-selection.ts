const f = Math.fround;
export interface InteractiveMirrorPointInput {
  normals: ArrayLike<number>;
  flags: ArrayLike<number>;
  direction: readonly number[];
  stride: number;
  onlySelected?: boolean;
  backfaces?: boolean;
  baseColor: readonly number[];
  selectedColor: readonly number[];
  allowanceMilliseconds: number;
  elapsedMilliseconds: number;
}

/** Original 8C04E0 point branch. The allowance reports elapsed time; it never caps vertices. */
export function nativeInteractiveMirrorPoints(
  input: InteractiveMirrorPointInput,
) {
  const count = input.flags.length;
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > 0xffffffff ||
    input.normals.length !== count * 3 ||
    !Number.isInteger(input.stride) ||
    input.stride < 0 ||
    input.stride > 0xffffffff ||
    [input.direction, input.baseColor, input.selectedColor].some(
      (v) => v.length !== 3 || !v.every((n) => Number.isFinite(f(n))),
    ) ||
    !Number.isInteger(input.allowanceMilliseconds) ||
    input.allowanceMilliseconds < 0 ||
    input.allowanceMilliseconds > 0x7fffffff ||
    !Number.isFinite(input.elapsedMilliseconds) ||
    input.elapsedMilliseconds < 0
  )
    throw new Error(
      "Mirror point rendering requires aligned normals/flags, finite XYZ/RGB values, an unsigned stride and a finite time allowance.",
    );
  const direction = input.direction.map(f);
  const zeroDirection = direction.every((v) => v === 0);
  const multiplier = zeroDirection ? f(1.8) : 1;
  const base = input.baseColor.map((v) => Math.min(1, f(f(v) * multiplier)));
  const selected = input.selectedColor.map((v) =>
    Math.min(1, f(f(v) * multiplier)),
  );
  const indices = new Uint32Array(count),
    colors = new Float32Array(count * 3);
  let used = 0,
    color = selected;
  for (let i = 0; i < count; i++) {
    const flags = input.flags[i];
    if (!Number.isInteger(flags) || flags < 0 || flags > 0xffffffff)
      throw new Error("Mirror vertex flags must be unsigned 32-bit integers.");
    if (
      (flags & 9) !== 0 ||
      (input.onlySelected && (flags & 2) === 0) ||
      ((input.stride | 0) >= 2 && i % input.stride !== 0)
    )
      continue;
    // The original loop only changes GL color for an unselected candidate.
    // Subsequent selected vertices inherit that color, even after a culled candidate.
    if ((flags & 2) === 0) color = base;
    if (!input.backfaces && !zeroDirection) {
      const nx = f(input.normals[i * 3]),
        ny = f(input.normals[i * 3 + 1]),
        nz = f(input.normals[i * 3 + 2]);
      if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz))
        throw new Error("Mirror vertex normals must be finite.");
      const dot = f(
        f(f(direction[1] * ny) + f(direction[0] * nx)) + f(direction[2] * nz),
      );
      // Native COMISS rejects unordered products as well as nonpositive normals.
      if (!(dot > 0)) continue;
    }
    indices[used] = i;
    colors[used * 3] = color[0];
    colors[used * 3 + 1] = color[1];
    colors[used * 3 + 2] = color[2];
    used++;
  }
  return {
    indices: indices.subarray(0, used),
    colors: colors.subarray(0, used * 3),
    complete: input.allowanceMilliseconds >= input.elapsedMilliseconds,
  };
}
