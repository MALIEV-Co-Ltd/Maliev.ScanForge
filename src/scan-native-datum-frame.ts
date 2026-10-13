/** Numerical frame stage used by native origin/reference alignment. */
export function nativeDatumPrimaryDirection(
  input: readonly number[],
  direction: readonly number[],
  axis: 0 | 1 | 2,
): number[] {
  if (
    input.length !== 12 ||
    direction.length !== 3 ||
    !input.every(Number.isFinite) ||
    !direction.every(Number.isFinite) ||
    ![0, 1, 2].includes(axis)
  )
    throw new Error(
      "Datum frame requires twelve finite matrix values, a finite direction and axis 0–2.",
    );
  const frame = [...input];
  const first = (axis + 1) % 3,
    second = (axis + 2) % 3;
  const [x, y, z] = direction;
  const a = [
    y * frame[first + 8] - z * frame[first + 4],
    z * frame[first] - x * frame[first + 8],
    x * frame[first + 4] - y * frame[first],
  ];
  const b = [
    z * frame[second + 4] - y * frame[second + 8],
    x * frame[second + 8] - z * frame[second],
    y * frame[second] - x * frame[second + 4],
  ];
  const normalize = (v: number[]) => {
    const length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (length >= Number.EPSILON) {
      const reciprocal = 1 / length;
      for (let i = 0; i < 3; i++) v[i] *= reciprocal;
    }
    return v;
  };
  const store = (column: number, v: number[]) => {
    for (let i = 0; i < 3; i++) frame[column + i * 4] = v[i];
  };
  if (
    a[1] * a[1] + a[0] * a[0] + a[2] * a[2] <=
    b[1] * b[1] + b[0] * b[0] + b[2] * b[2]
  ) {
    const v = normalize([
      y * b[2] - z * b[1],
      z * b[0] - x * b[2],
      x * b[1] - y * b[0],
    ]);
    store(second, v);
    store(
      first,
      normalize([
        z * v[1] - y * v[2],
        x * v[2] - z * v[0],
        y * v[0] - x * v[1],
      ]),
    );
  } else {
    const v = normalize([
      z * a[1] - y * a[2],
      x * a[2] - z * a[0],
      y * a[0] - x * a[1],
    ]);
    store(first, v);
    store(
      second,
      normalize([
        y * v[2] - z * v[1],
        z * v[0] - x * v[2],
        x * v[1] - y * v[0],
      ]),
    );
  }
  for (let i = 0; i < 3; i++) frame[axis + i * 4] = direction[i];
  const error =
    (frame[5] * frame[10] - frame[6] * frame[9]) * frame[0] -
    (frame[4] * frame[10] - frame[8] * frame[6]) * frame[1] +
    (frame[4] * frame[9] - frame[8] * frame[5]) * frame[2] -
    1;
  return Math.abs(error) > 2 ** -23 ? [...input] : frame;
}
