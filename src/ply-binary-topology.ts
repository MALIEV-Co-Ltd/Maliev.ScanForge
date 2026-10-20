/** Read the scanner's packed schema without Three's intermediate number arrays. */
export function parsePackedBinaryPly(data: ArrayBuffer) {
  const bytes = new Uint8Array(data);
  let headerEnd = 0;
  let lineStart = 0;
  // Unusual or large headers retain the general loader's behavior.
  for (let i = 0; i < Math.min(bytes.length, 65536); i++) {
    if (bytes[i] > 127) return;
    if (bytes[i] !== 10) continue;
    const line = new TextDecoder()
      .decode(bytes.subarray(lineStart, i))
      .trimEnd();
    if (line === "end_header") {
      headerEnd = i + 1;
      break;
    }
    lineStart = i + 1;
  }
  if (!headerEnd) return;
  const header = new TextDecoder()
    .decode(bytes.subarray(0, headerEnd))
    .split(/\r?\n/)
    .filter((line) => !/^comment(?: |$)/.test(line))
    .join("\n");
  const match =
    /^ply\nformat binary_little_endian 1\.0\nelement vertex (\d+)\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nelement face (\d+)\nproperty list uchar int vertex_indices\nend_header\n$/.exec(
      header,
    );
  if (!match) return;
  const vertexCount = Number(match[1]);
  const faceCount = Number(match[2]);
  const vertexBytes = vertexCount * 24;
  const faceBytes = faceCount * 13;
  if (
    !Number.isSafeInteger(vertexCount) ||
    !Number.isSafeInteger(faceCount) ||
    vertexCount <= 0 ||
    faceCount <= 0 ||
    !Number.isSafeInteger(vertexBytes + faceBytes + headerEnd) ||
    headerEnd + vertexBytes + faceBytes !== data.byteLength
  )
    return;
  const view = new DataView(data);
  const faceStart = headerEnd + vertexBytes;
  // Check every record before allocating: polygon files belong to PLYLoader.
  for (let offset = faceStart; offset < data.byteLength; offset += 13) {
    if (view.getUint8(offset) !== 3) return;
  }
  const vertices = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const triangles = new Uint32Array(faceCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const offset = headerEnd + vertex * 24;
    for (let axis = 0; axis < 3; axis++) {
      const coordinate = view.getFloat32(offset + axis * 4, true);
      const normal = view.getFloat32(offset + 12 + axis * 4, true);
      if (!Number.isFinite(coordinate))
        throw new Error("Invalid PLY coordinates: values must be finite.");
      vertices[vertex * 3 + axis] = coordinate;
      normals[vertex * 3 + axis] = normal;
    }
  }
  for (let face = 0; face < faceCount; face++) {
    for (let corner = 0; corner < 3; corner++) {
      const id = view.getInt32(faceStart + face * 13 + 1 + corner * 4, true);
      if (id < 0 || id >= vertexCount)
        throw new Error("PLY face index is outside the vertex buffer.");
      triangles[face * 3 + corner] = id;
    }
  }
  if (!normals.every(Number.isFinite))
    throw new Error("PLY vertex normals must be finite.");
  return { vertices, triangles, normals };
}
