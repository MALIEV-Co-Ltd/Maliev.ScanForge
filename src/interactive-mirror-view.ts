/** Original renderer 833570: transpose the supplied view basis after subtracting its translation. */
export function nativeInteractiveViewPoint(
  frame: readonly number[],
  anchor: readonly number[],
  point: readonly number[],
): number[] {
  if (
    frame.length !== 12 ||
    anchor.length !== 3 ||
    point.length !== 3 ||
    ![...frame, ...anchor, ...point].every(Number.isFinite)
  )
    throw new Error(
      "Interactive view conversion requires a finite 3x4 frame and XYZ anchor/point.",
    );
  const x = point[0] - frame[3],
    y = point[1] - frame[7],
    z = point[2] - frame[11];
  return [
    frame[0] * x + frame[4] * y + frame[8] * z + anchor[0],
    frame[1] * x + frame[5] * y + frame[9] * z + anchor[1],
    frame[6] * y + frame[2] * x + frame[10] * z + anchor[2],
  ];
}

/** Original 836100 rounds both unprojected endpoints before subtracting, without normalization. */
export function nativeInteractiveMirrorDirection(
  frame: readonly number[],
  anchor: readonly number[],
): number[] {
  const origin = nativeInteractiveViewPoint(frame, anchor, [0, 0, 0]);
  const end = nativeInteractiveViewPoint(frame, anchor, [0, 0, 1]);
  const direction = end.map((v, i) =>
    Math.fround(Math.fround(v) - Math.fround(origin[i])),
  );
  if (!direction.every(Number.isFinite))
    throw new Error(
      "Interactive mirror direction exceeds the finite Float32 range.",
    );
  return direction;
}

/** Original 69B280 supplies a Float32 column-major object pose to GL after the wrapper reflection. */
export function nativeInteractiveMirrorModelMatrix(
  pose: readonly number[],
): Float32Array {
  if (pose.length !== 12 || !pose.every((v) => Number.isFinite(Math.fround(v))))
    throw new Error(
      "Interactive mirror display requires a finite Float32 3x4 pose.",
    );
  return Float32Array.from([
    pose[0],
    pose[4],
    pose[8],
    0,
    pose[1],
    pose[5],
    pose[9],
    0,
    pose[2],
    pose[6],
    pose[10],
    0,
    pose[3],
    pose[7],
    pose[11],
    1,
  ]);
}

/** Original 69E900 origin-plane reflection, before each object's Float32 pose. */
export function nativeInteractiveMirrorPlane(plane: number): number[] {
  if (!Number.isInteger(plane) || plane < 0 || plane > 2)
    throw new Error("Choose XY, YZ or XZ for the mirror plane.");
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  matrix[[10, 0, 5][plane]] = -1;
  return matrix;
}
