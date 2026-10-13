/** Original two-level subdivision; lookup intentionally uses its own axis convention. */
export function nativeAlignmentBucketTree(bounds: ArrayLike<number>) {
  if (bounds.length !== 6) throw new Error("Invalid alignment bucket bounds.");
  const centers: number[] = [];
  const children: number[] = [];
  function create(box: number[], depth: number): number {
    const node = centers.length / 3;
    const center = [0, 1, 2].map((axis) =>
      Math.fround(Math.fround(box[axis] + box[axis + 3]) * 0.5),
    );
    centers.push(...center);
    children.push(...Array<number>(8).fill(-1));
    if (depth) {
      for (let octant = 0; octant < 8; octant++) {
        const child = box.slice();
        for (let axis = 0; axis < 3; axis++) {
          if (octant & (1 << axis)) child[axis] = center[axis];
          else child[axis + 3] = center[axis];
        }
        children[node * 8 + octant] = create(child, depth - 1);
      }
    }
    return node;
  }
  create(Array.from(bounds, Math.fround), 2);
  return {
    centers: new Float32Array(centers),
    children: new Int32Array(children),
  };
}

/** Original spatial bucket lookup. */
export function nativeAlignmentSpatialBucket(
  point: ArrayLike<number>,
  centers: ArrayLike<number>,
  children: ArrayLike<number>,
  tolerance = 0,
  seed = 0,
) {
  const count = centers.length / 3;
  if (!Number.isInteger(count) || count < 1 || children.length !== count * 8)
    throw new Error("Invalid alignment bucket tree.");
  const x = Math.fround(point[0]);
  const y = Math.fround(point[1]);
  const z = Math.fround(point[2]);
  const offset = Math.fround(tolerance);
  let node = 0;
  let bucket = seed | 0;
  for (let visited = 0; visited < count; visited++) {
    const octant =
      Number(x >= Math.fround(Math.fround(centers[node * 3]) + offset)) |
      (y < Math.fround(Math.fround(centers[node * 3 + 1]) + offset) ? 2 : 0) |
      (z < Math.fround(Math.fround(centers[node * 3 + 2]) + offset) ? 4 : 0);
    bucket = (bucket * 8 + octant) | 0;
    const next = children[node * 8 + octant];
    if (next === -1) return bucket;
    if (!Number.isSafeInteger(next) || next < 0 || next >= count)
      throw new Error("Alignment bucket child is outside the tree.");
    node = next;
  }
  throw new Error("Alignment bucket tree contains a cycle.");
}
