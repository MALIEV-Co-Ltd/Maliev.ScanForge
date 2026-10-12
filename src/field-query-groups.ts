import type { GuideQueryNode } from "./field-surface-query";

/** Recovered tree-depth face labels. This consumes the original ordered tree, not a clustering heuristic. */
export function groupGuideQueryFaces(
  nodes: readonly GuideQueryNode[],
  faces: Uint32Array,
  root: number,
  faceCount: number,
  targetDepth: number,
): { labels: Int32Array; groups: number } {
  if (
    !Number.isInteger(faceCount) ||
    faceCount < 0 ||
    faceCount > 0x7fffffff ||
    !Number.isInteger(targetDepth) ||
    targetDepth < -0x80000000 ||
    targetDepth > 0x7fffffff
  )
    throw new Error("Query grouping dimensions or depth are invalid");
  for (const face of faces)
    if (face >= faceCount) throw new Error("Query grouping face is invalid");
  const labels = new Int32Array(faceCount);
  let groups = 0;
  const seen = new Set<number>();
  const stack = [{ index: root, depth: 0, after: false }];
  while (stack.length) {
    const { index, depth, after } = stack.pop()!;
    if (after) {
      groups++;
      continue;
    }
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= nodes.length ||
      seen.has(index)
    )
      throw new Error("Query grouping tree is invalid or cyclic");
    seen.add(index);
    const node = nodes[index];
    const range = node.range;
    if (
      range &&
      (!Number.isInteger(range[0]) ||
        !Number.isInteger(range[1]) ||
        range[0] < 0 ||
        range[1] < range[0] ||
        range[1] > faces.length ||
        (range[0] === range[1] && range[0] !== 0))
    )
      throw new Error("Query grouping leaf range is invalid");
    if (range && range[0] < range[1]) {
      const [start, end] = range;
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end > faces.length
      )
        throw new Error("Query grouping leaf range is invalid");
      for (let ordinal = start; ordinal < end; ordinal++)
        labels[faces[ordinal]] = groups;
      if (depth <= targetDepth) groups++;
    } else {
      if (depth === targetDepth) stack.push({ index, depth, after: true });
      if (node.children?.[0] !== null && node.children?.[0] !== undefined) {
        const [first, second] = node.children;
        if (first === null || second === null)
          throw new Error("Query grouping second child is missing");
        stack.push({ index: second, depth: depth + 1, after: false });
        stack.push({ index: first, depth: depth + 1, after: false });
      }
    }
  }
  return { labels, groups };
}
