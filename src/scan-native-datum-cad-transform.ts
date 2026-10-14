import { nativeDatumInverseFrame } from "./scan-native-datum-apply";

/** Original exact-CAD frame conversion before OpenCascade's no-copy shape transform. */
export function nativeDatumCadTransform(input: readonly number[]): number[] {
  const inverse = nativeDatumInverseFrame(input);
  const normalize = (v: number[]) => {
    const length = Math.sqrt(v[1] * v[1] + v[0] * v[0] + v[2] * v[2]);
    if (!(length > 2.2250738585072014e-308))
      throw new Error("CAD alignment frame axes are degenerate.");
    return v.map((value) => value / length);
  };
  const a = normalize([inverse[0], inverse[4], inverse[8]]),
    b = normalize([inverse[2], inverse[6], inverse[10]]),
    origin = [inverse[3], inverse[7], inverse[11]];
  const cz = a[0] * b[1] - b[0] * a[1],
    cy = a[2] * b[0] - b[2] * a[0],
    cx = b[2] * a[1] - a[2] * b[1];
  const x = normalize([
    b[1] * cz - b[2] * cy,
    cx * b[2] - b[0] * cz,
    b[0] * cy - cx * b[1],
  ]);
  const y = normalize([
    b[1] * x[2] - b[2] * x[1],
    x[0] * b[2] - b[0] * x[2],
    b[0] * x[1] - x[0] * b[1],
  ]);
  return [x, y, b].flatMap((row) => [
    ...row,
    -(row[0] * origin[0] + row[1] * origin[1] + row[2] * origin[2]),
  ]);
}
