import type { GuideQueryNode } from "./field-surface-query";

/** Recovered ordered midpoint tree. Bounds collection and allocation policy are separate. */
export function buildGuideQueryTree(
  faceBounds: readonly Float32Array[],
  inputFaces: Uint32Array,
  bounds: Float32Array,
  options = { minimumChild: 2, fallbackLeaf: 10, leafSize: 5 },
): { faces: Uint32Array; nodes: GuideQueryNode[]; root: number | null } {
  const f = Math.fround;
  const validateBounds = (box: Float32Array) => {
    if (
      box.length !== 6 ||
      !box.every(Number.isFinite) ||
      [0, 1, 2].some((a) => box[a] > box[a + 3])
    )
      throw new Error("Query tree requires finite ordered bounds");
  };
  validateBounds(bounds);
  for (const box of faceBounds) validateBounds(box);
  for (const face of inputFaces)
    if (face >= faceBounds.length)
      throw new Error("Query tree face is invalid");
  if (
    Object.values(options).some(
      (value) => !Number.isInteger(value) || value < 1 || value > 0x7fffffff,
    )
  )
    throw new Error("Query tree policy requires positive signed integers");
  const faces = inputFaces.slice(),
    nodes: GuideQueryNode[] = [];
  const scratch = new Uint32Array(faces.length);
  const crossing = new Uint32Array(faces.length);
  const union = (start: number, end: number): Float32Array => {
    const box = faceBounds[faces[start]].slice();
    for (let i = start + 1; i < end; i++)
      for (let a = 0; a < 3; a++) {
        box[a] = Math.min(box[a], faceBounds[faces[i]][a]);
        box[a + 3] = Math.max(box[a + 3], faceBounds[faces[i]][a + 3]);
      }
    return box;
  };
  const build = (box: Float32Array, start: number, end: number): number => {
    const index = nodes.length,
      count = end - start;
    nodes.push({ bounds: box.slice(), range: [start, end] });
    if (count <= options.leafSize) return index;
    const x = f(box[3] - box[0]),
      y = f(box[4] - box[1]),
      z = f(box[5] - box[2]);
    const axis = x <= y ? (y < z ? 2 : 1) : z <= x ? 0 : 2;
    const midpoint = f(f(box[axis + 3] + box[axis]) * f(0.5));
    let left = 0,
      right = count,
      crossingCount = 0;
    for (let i = start; i < end; i++) {
      const face = faces[i],
        candidate = faceBounds[face];
      if (candidate[axis] < midpoint) {
        if (midpoint < candidate[axis + 3]) crossing[crossingCount++] = face;
        else scratch[left++] = face;
      } else scratch[--right] = face;
    }
    for (let i = 0; i < crossingCount; i++) {
      const face = crossing[i],
        candidate = faceBounds[face];
      if (f(midpoint - candidate[axis]) < f(candidate[axis + 3] - midpoint))
        scratch[--right] = face;
      else scratch[left++] = face;
    }
    faces.set(scratch.subarray(0, count), start);
    let split = start + left;
    if (
      split < start + options.minimumChild ||
      end - options.minimumChild < split
    ) {
      if (count <= options.fallbackLeaf) return index;
      split = (end + start) >>> 1;
    }
    // Native code computes both child bounds before either recursive call.
    const firstBounds = union(start, split),
      secondBounds = union(split, end);
    const first = build(firstBounds, start, split);
    const second = build(secondBounds, split, end);
    nodes[index] = { bounds: box.slice(), children: [first, second] };
    return index;
  };
  return {
    faces,
    nodes,
    root: faces.length ? build(bounds, 0, faces.length) : null,
  };
}
