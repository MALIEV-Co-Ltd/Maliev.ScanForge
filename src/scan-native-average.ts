import type { IndexedMesh, Positions } from "./types";
import type { MeshProcessingOptions } from "./mesh-processing";
import { indexedMeshMatches } from "./indexed-mesh";
import { nativeStlTopology } from "./scan-native-stl-topology";
import { prepareNativeAlignmentSurface } from "./scan-native-alignment-surface";
import { AVERAGE_MAX_COORDINATES } from "./scan-average-request";

/** Query original points; each accepted contribution narrows through a Float32 store. */
export function nativeAverageCoordinates(
  positions: Positions,
  targets: Positions[],
  targetTopology: readonly (IndexedMesh | undefined)[] | undefined,
  tolerance: number,
  options: MeshProcessingOptions,
) {
  if (targetTopology && targetTopology.length !== targets.length)
    throw new Error(
      "Average topology must correspond to every reference mesh.",
    );
  if (
    (targetTopology?.reduce(
      (count, mesh) => count + (mesh?.vertices.length ?? 0),
      0,
    ) ?? 0) > AVERAGE_MAX_COORDINATES
  )
    throw new Error(
      "Indexed reference vertices exceed the Average processing limit.",
    );
  const output = new Float32Array(positions);
  const counts = new Uint8Array(positions.length / 3).fill(1);
  const point = [0, 0, 0];
  const progress = (fraction: number, stage: string) => {
    options.signal?.throwIfAborted();
    options.onProgress?.(fraction, stage);
    options.signal?.throwIfAborted();
  };
  for (let reference = 0; reference < targets.length; reference++) {
    const target = targets[reference];
    const supplied = targetTopology?.[reference];
    if (supplied && !indexedMeshMatches(supplied, target))
      throw new Error(
        "Average reference topology does not match its coordinates.",
      );
    const prepareProgress = (fraction: number) =>
      progress(
        (reference + fraction * 0.7) / targets.length,
        "Preparing reference surface",
      );
    prepareProgress(0);
    const mesh =
      supplied ??
      nativeStlTopology(new Float32Array(target), {
        signal: options.signal,
        onProgress: (fraction) => prepareProgress(fraction * 0.4),
      });
    const prepared = mesh.triangles.length
      ? prepareNativeAlignmentSurface(mesh.vertices, mesh.triangles, {
          signal: options.signal,
          onProgress: (fraction) => prepareProgress(0.4 + fraction * 0.6),
        })
      : undefined;
    for (let offset = 0; offset < positions.length; offset += 3) {
      if (offset % 3072 === 0)
        progress(
          (reference + 0.7 + (0.3 * offset) / positions.length) /
            targets.length,
          "Averaging reference surface",
        );
      for (let axis = 0; axis < 3; axis++)
        point[axis] = Math.fround(positions[offset + axis]);
      const hit = prepared?.query(point, tolerance);
      if (!hit || hit.openBoundary) continue;
      for (let axis = 0; axis < 3; axis++)
        output[offset + axis] += hit.closest[axis];
      counts[offset / 3]++;
    }
  }
  let matched = 0;
  for (let offset = 0; offset < output.length; offset += 3) {
    if (offset % 3072 === 0) options.signal?.throwIfAborted();
    const count = counts[offset / 3];
    if (count > 1) matched++;
    for (let axis = 0; axis < 3; axis++) output[offset + axis] /= count;
  }
  options.signal?.throwIfAborted();
  return { positions: output, matched };
}
