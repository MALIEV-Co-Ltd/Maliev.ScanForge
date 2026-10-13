import {
  packNoiseOctree,
  prepareNoiseOctree,
  type NoiseTreeTriangle,
  type NoiseTreeNode,
} from "./scan-noise-octree";
import type { NoiseBounds } from "./scan-noise-octree-query";
import type { MeshProcessingOptions } from "./mesh-processing";

/** Original target builder's excluded-triangle bit is 2, not the source vertex visibility bit. */
export function prepareNativeAlignmentTarget(
  triangles: readonly NoiseTreeTriangle[],
  options: MeshProcessingOptions & {
    minimumExtent?: number;
    filterExcluded?: boolean;
    triangleFlags?: ArrayLike<number>;
    cachedBounds?: NoiseBounds;
  } = {},
) {
  if (
    options.triangleFlags &&
    options.triangleFlags.length !== triangles.length
  )
    throw new Error("Target flags must describe every triangle.");
  const ids = triangles
    .map((_, id) => id)
    .filter(
      (id) =>
        !options.filterExcluded || !((options.triangleFlags?.[id] ?? 0) & 2),
    );
  if (!ids.length) return undefined;
  const extent = Math.fround(options.minimumExtent ?? 0.5);
  const prepared = prepareNoiseOctree(
    ids.map((id) => triangles[id]),
    extent,
    10,
    options,
    options.filterExcluded ? undefined : options.cachedBounds,
  );
  if (ids.length === triangles.length) return prepared;
  const remap = (node: NoiseTreeNode) => {
    node.triangles = node.triangles.map((id) => ids[id]);
    for (const child of Object.values(node.children)) if (child) remap(child);
  };
  remap(prepared.root);
  // Keep original triangle IDs usable by cached normals and neighbor arrays.
  const packed = packNoiseOctree(triangles, extent, 10, options);
  return { ...packed, root: prepared.root };
}
