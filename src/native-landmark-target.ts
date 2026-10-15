import type { IndexedMesh } from "./types";
import type { MeshProcessingOptions } from "./mesh-processing";
import { noiseNormals } from "./scan-native-noise";

/** Original picked-point caller joins target records without welding, then
 * refreshes facet and vertex normals before constructing its target query tree.
 */
export function prepareNativeLandmarkTarget(
  targets: readonly IndexedMesh[],
  options: MeshProcessingOptions = {},
) {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  check();
  let coordinates = 0;
  let indices = 0;
  for (const target of targets) {
    if (target.vertices.length % 3 || target.triangles.length % 3)
      throw new Error(
        "Alignment targets require complete vertices and triangles.",
      );
    coordinates += target.vertices.length;
    indices += target.triangles.length;
  }
  const vertices = new Float32Array(coordinates);
  const triangles = new Uint32Array(indices);
  let coordinateOffset = 0;
  let triangleOffset = 0;
  for (const target of targets) {
    check();
    vertices.set(target.vertices, coordinateOffset);
    const vertexOffset = coordinateOffset / 3;
    const count = target.vertices.length / 3;
    for (let index = 0; index < target.triangles.length; index++) {
      if (index % 4096 === 0) check();
      const id = target.triangles[index];
      if (!Number.isInteger(id) || id < 0 || id >= count)
        throw new Error(
          "Alignment target triangle references a missing vertex.",
        );
      triangles[triangleOffset + index] = id + vertexOffset;
    }
    coordinateOffset += target.vertices.length;
    triangleOffset += target.triangles.length;
  }
  const normals = noiseNormals(
    { vertices: Float64Array.from(vertices), triangles },
    options,
  );
  return { vertices, triangles, normals };
}
