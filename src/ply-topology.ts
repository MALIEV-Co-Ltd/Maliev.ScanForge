import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { parsePackedBinaryPly } from "./ply-binary-topology";

/** Preserve file vertex and face order for indexed native geometry operations.
 * Coordinate welding cannot recover this order from rendered triangle soup.
 */
export function parsePlyTopology(
  data: ArrayBuffer,
  options: { onNormals?: (normals: Float32Array) => void } = {},
) {
  const packed = parsePackedBinaryPly(data);
  if (packed) {
    options.onNormals?.(packed.normals);
    return packed;
  }
  const geometry = new PLYLoader().parse(data);
  try {
    const position = geometry.getAttribute("position");
    const index = geometry.index;
    if (!index || !index.count)
      throw new Error(
        "PLY must contain polygon faces. Point clouds are not supported yet.",
      );
    if (!position || position.itemSize !== 3 || index.count % 3)
      throw new Error("Invalid indexed PLY triangle geometry.");
    // This private loader geometry owns CPU buffers that remain valid after dispose.
    const vertices =
      position.array instanceof Float32Array
        ? position.array
        : Float32Array.from(position.array);
    if (!vertices.length || !vertices.every(Number.isFinite))
      throw new Error("Invalid PLY coordinates: values must be finite.");
    const ownedIndices =
      index.array instanceof Uint32Array &&
      index.itemSize === 1 &&
      !index.normalized &&
      index.array.length === index.count
        ? index.array
        : undefined;
    const triangles = ownedIndices ?? new Uint32Array(index.count);
    for (let slot = 0; slot < index.count; slot++) {
      const id = index.getX(slot);
      if (!Number.isSafeInteger(id) || id < 0 || id >= position.count)
        throw new Error("PLY face index is outside the vertex buffer.");
      if (!ownedIndices) triangles[slot] = id;
    }
    let normals: Float32Array | undefined;
    const normal = geometry.getAttribute("normal");
    if (normal) {
      if (normal.itemSize !== 3 || normal.count !== position.count)
        throw new Error("Invalid PLY vertex normals.");
      normals =
        normal.array instanceof Float32Array
          ? normal.array
          : Float32Array.from(normal.array);
      if (!normals.every(Number.isFinite))
        throw new Error("PLY vertex normals must be finite.");
      options.onNormals?.(normals);
    }
    return { vertices, triangles, ...(normals ? { normals } : {}) };
  } finally {
    geometry.dispose();
  }
}

export function expandPlyTopology(
  topology: {
    vertices: ArrayLike<number>;
    triangles: ArrayLike<number>;
  },
  sharedReadonlyBuffers = false,
): Float32Array {
  const length = topology.triangles.length * 3;
  const positions =
    sharedReadonlyBuffers &&
    globalThis.crossOriginIsolated === true &&
    typeof SharedArrayBuffer !== "undefined"
      ? new Float32Array(new SharedArrayBuffer(length * 4))
      : new Float32Array(length);
  for (let slot = 0; slot < topology.triangles.length; slot++) {
    const offset = topology.triangles[slot] * 3;
    positions[slot * 3] = topology.vertices[offset];
    positions[slot * 3 + 1] = topology.vertices[offset + 1];
    positions[slot * 3 + 2] = topology.vertices[offset + 2];
  }
  return positions;
}
