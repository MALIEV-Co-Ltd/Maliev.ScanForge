import {
  packNoiseOctree,
  prepareNoiseOctree,
  type NoiseTreeTriangle,
  type NoiseTreeNode,
  type NoiseIndexedSurface,
} from "./scan-noise-octree";
import type { NoiseBounds } from "./scan-noise-octree-query";
import type { MeshProcessingOptions } from "./mesh-processing";

/** Original target builder's excluded-triangle bit is 2, not the source vertex visibility bit. */
export function prepareNativeAlignmentTarget(
  triangles: readonly NoiseTreeTriangle[] | NoiseIndexedSurface,
  options: MeshProcessingOptions & {
    minimumExtent?: number;
    filterExcluded?: boolean;
    triangleFlags?: ArrayLike<number>;
    cachedBounds?: NoiseBounds;
  } = {},
) {
  const indexed = Array.isArray(triangles)
    ? undefined
    : (triangles as NoiseIndexedSurface);
  const lists = triangles as readonly NoiseTreeTriangle[];
  const count = indexed ? indexed.indices.length / 3 : lists.length;
  if (!Number.isInteger(count))
    throw new Error("Target requires complete triangles.");
  if (options.triangleFlags && options.triangleFlags.length !== count)
    throw new Error("Target flags must describe every triangle.");
  const ids = Array.from({ length: count }, (_, id) => id).filter(
    (id) =>
      !options.filterExcluded || !((options.triangleFlags?.[id] ?? 0) & 2),
  );
  if (!ids.length) return undefined;
  const extent = Math.fround(options.minimumExtent ?? 0.5);
  let selected = triangles;
  if (ids.length !== count) {
    if (indexed) {
      const indices = new Uint32Array(ids.length * 3);
      for (let offset = 0; offset < ids.length; offset++) {
        if (offset % 4096 === 0 && options.signal?.aborted)
          throw new DOMException("Mesh operation cancelled.", "AbortError");
        for (let corner = 0; corner < 3; corner++)
          indices[offset * 3 + corner] =
            indexed.indices[ids[offset] * 3 + corner];
      }
      selected = { coordinates: indexed.coordinates, indices };
    } else selected = ids.map((id) => lists[id]);
  }
  const prepared = prepareNoiseOctree(
    selected,
    extent,
    10,
    options,
    options.filterExcluded ? undefined : options.cachedBounds,
  );
  if (ids.length === count) return prepared;
  const remap = (node: NoiseTreeNode) => {
    node.triangles = node.triangles.map((id) => ids[id]);
    for (const child of Object.values(node.children)) if (child) remap(child);
  };
  remap(prepared.root);
  // Keep original triangle IDs usable by cached normals and neighbor arrays.
  const packed = packNoiseOctree(triangles, extent, 10, options);
  return { ...packed, root: prepared.root };
}
