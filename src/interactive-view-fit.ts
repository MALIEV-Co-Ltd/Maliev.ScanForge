const f = Math.fround;
/** Original 8A8E20 perspective branch: Double radius/tan, then Float32 eye stores. */
export function nativeInteractivePerspectiveSetup(
  bounds: readonly number[],
  anchor: readonly number[],
  fieldOfView: number,
  aspect: number,
  clipping: readonly number[],
) {
  const b = bounds.map(f),
    a = anchor.map(f),
    fov = f(fieldOfView),
    ratio = f(aspect),
    clip = clipping.map(f);
  if (
    b.length !== 6 ||
    a.length !== 3 ||
    clip.length !== 2 ||
    ![...b, ...a, fov, ratio, ...clip].every(Number.isFinite) ||
    b.some((v, i) => i < 3 && v > b[i + 3]) ||
    fov <= 0 ||
    fov >= 180 ||
    ratio <= 0 ||
    clip[0] <= 0 ||
    clip[1] <= clip[0]
  )
    throw new Error(
      "Interactive perspective setup requires finite ordered bounds, XYZ anchor, field of view, aspect and positive clipping range.",
    );
  const half = [0, 1, 2].map((i) => f(f(f(b[i + 3] + b[i]) * 0.5) - b[i]));
  const radius = Math.sqrt(
    half[0] * half[0] + half[1] * half[1] + half[2] * half[2],
  );
  const distance = f(radius / Math.tan(fov * 0.5 * 0.017453292519943295));
  return {
    perspective: [fov, ratio, ...clip],
    lookAt: [a[0], a[1], f(distance + a[2]), ...a, 0, 1, 0],
  };
}
/** Original 832930/832980/8458C0/8A96B0/8A9500 publication chain; no renderer calls. */
export function nativeInteractiveFitView(
  frame: readonly number[],
  sourceBounds: readonly number[],
  initialClipping: readonly number[] = [-10000, 10000],
) {
  if (
    frame.length !== 12 ||
    sourceBounds.length !== 6 ||
    initialClipping.length !== 2 ||
    ![...frame, ...sourceBounds, ...initialClipping].every(Number.isFinite)
  )
    throw new Error(
      "Native Interactive fit requires finite frame, bounds and clipping values.",
    );
  const storedFrame = [...frame];
  storedFrame[11] = 0;
  const b = sourceBounds.map(f);
  const limit = 3.4028234663852886e38;
  const valid = [0, 1, 2].every(
    (a) => b[a] <= b[a + 3] && b[a] > -limit && b[a + 3] < limit,
  );
  let viewBounds = [-1, -1, -1, 1, 1, 1],
    clipping = [...initialClipping];
  if (valid) {
    const min = [Number.MAX_VALUE, Number.MAX_VALUE],
      max = [-Number.MAX_VALUE, -Number.MAX_VALUE];
    for (const corner of [
      [0, 1, 2],
      [3, 1, 2],
      [3, 4, 2],
      [0, 4, 2],
      [0, 1, 5],
      [3, 1, 5],
      [3, 4, 5],
      [0, 4, 5],
    ]) {
      for (let r = 0; r < 2; r++) {
        const k = r * 4,
          v =
            b[corner[0]] * storedFrame[k] +
            b[corner[1]] * storedFrame[k + 1] +
            b[corner[2]] * storedFrame[k + 2] +
            storedFrame[k + 3];
        if (v < min[r]) min[r] = v;
        if (max[r] < v) max[r] = v;
      }
    }
    const half = min.map((v, r) => Math.abs((max[r] + v) * 0.5 - v));
    const pad = f(1.15),
      radius = Math.sqrt(half[1] * half[1] + half[0] * half[0] + 0);
    const center = [0, 1, 2].map((a) => f(f(b[a + 3] + b[a]) * 0.5));
    const extent = [half[0] * pad, half[1] * pad, f(f(radius) * pad)];
    viewBounds = [
      ...center.map((v, a) => f(v - extent[a])),
      ...center.map((v, a) => f(v + extent[a])),
    ];
    const midZ = (viewBounds[5] + viewBounds[2]) * 0.5;
    const halfX = (viewBounds[3] + viewBounds[0]) * 0.5 - viewBounds[0],
      halfY = (viewBounds[4] + viewBounds[1]) * 0.5 - viewBounds[1];
    const dz = midZ - viewBounds[2],
      distance = Math.sqrt(halfY * halfY + halfX * halfX + dz * dz) * 4;
    if (distance > 1.1920928955078125e-7)
      clipping = [
        f(Math.min(-distance, -midZ - distance)),
        f(Math.max(distance, distance - midZ)),
      ];
  }
  const anchor = [0, 1, 2].map(
    (a) => (viewBounds[a + 3] + viewBounds[a]) * 0.5,
  );
  return { storedFrame, viewBounds, anchor, clipping };
}
/** Original 8A6E40: average the required aspect correction, then Float32 bounds stores. */
export function nativeInteractiveAspectBounds(
  bounds: readonly number[],
  aspect: number,
) {
  if (
    bounds.length !== 6 ||
    !bounds.every(Number.isFinite) ||
    !Number.isFinite(aspect) ||
    aspect <= 0
  )
    throw new Error(
      "Interactive aspect fit requires finite bounds and a positive aspect.",
    );
  let width = bounds[3] - bounds[0],
    height = bounds[4] - bounds[1],
    nextHeight = width / aspect,
    ratio: number;
  if (width < 0 || height < 0 || (width === 0 && height === 0))
    throw new Error(
      "Interactive aspect fit requires nonempty ordered XY bounds.",
    );
  const centerX = f((bounds[0] + bounds[3]) * 0.5),
    centerY = f((bounds[1] + bounds[4]) * 0.5);
  if (height <= nextHeight) ratio = ((height + nextHeight) * 0.5) / nextHeight;
  else {
    const nextWidth = height * aspect;
    ratio = ((width + nextWidth) * 0.5) / nextWidth;
    width = nextWidth;
    nextHeight = height;
  }
  const halfX = f(ratio * width * 0.5),
    halfY = f(ratio * nextHeight * 0.5);
  const viewBounds = [
    f(centerX - halfX),
    f(centerY - halfY),
    bounds[2],
    f(halfX + centerX),
    f(halfY + centerY),
    bounds[5],
  ];
  return {
    viewBounds,
    anchor: [0, 1, 2].map((a) => (viewBounds[a + 3] + viewBounds[a]) * 0.5),
  };
}
