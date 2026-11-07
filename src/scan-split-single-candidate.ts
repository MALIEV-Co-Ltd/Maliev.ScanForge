/** Expand immutable owned seam buffers without welding or changing vertex IDs. */
export function expandFiniteSeamedMesh(
  mesh: { vertices: Float32Array; triangles: Uint32Array },
  options: {
    signal?: AbortSignal;
    maxTypedBytes?: number;
    check?: () => void;
  } = {},
) {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    options.check?.();
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
  };
  check();
  if (mesh.vertices.length % 3 || mesh.triangles.length % 3)
    throw new Error("Finite seam geometry is incomplete.");
  const bytes = mesh.triangles.length * 3 * 4;
  const allowance = options.maxTypedBytes ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(allowance) || allowance < 0 || bytes > allowance)
    throw new Error("Finite seam output typed memory budget exceeded.");
  for (let i = 0; i < mesh.triangles.length; i++) {
    if ((i & 4095) === 0) check();
    const base = mesh.triangles[i] * 3;
    if (base + 2 >= mesh.vertices.length)
      throw new Error("Finite seam output vertex index is invalid.");
    if (
      ![
        mesh.vertices[base],
        mesh.vertices[base + 1],
        mesh.vertices[base + 2],
      ].every(Number.isFinite)
    )
      throw new Error("Finite seam output coordinates must be finite.");
  }
  const positions = new Float32Array(mesh.triangles.length * 3);
  for (let i = 0; i < mesh.triangles.length; i++) {
    if ((i & 4095) === 0) check();
    const base = mesh.triangles[i] * 3;
    positions[i * 3] = mesh.vertices[base];
    positions[i * 3 + 1] = mesh.vertices[base + 1];
    positions[i * 3 + 2] = mesh.vertices[base + 2];
  }
  check();
  return { positions, indexedMesh: mesh };
}

/** Experimental single-container alternative; native object ownership is not established. */
export function combineFiniteSplitParts(
  segments: readonly Float32Array[],
  meshes: readonly { vertices: Float32Array; triangles: Uint32Array }[],
  options: {
    signal?: AbortSignal;
    maxTypedBytes?: number;
    check?: () => void;
  } = {},
): {
  positions: Float32Array;
  indexedMesh: { vertices: Float32Array; triangles: Uint32Array };
} {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    options.check?.();
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
  };
  check();
  if (segments.length !== meshes.length)
    throw new Error("Finite split part count does not match.");
  let vertexValues = 0,
    slots = 0,
    coordinates = 0;
  for (let part = 0; part < segments.length; part++) {
    check();
    const positions = segments[part],
      mesh = meshes[part];
    if (
      mesh.vertices.length % 3 ||
      mesh.triangles.length % 3 ||
      positions.length !== mesh.triangles.length * 3
    )
      throw new Error("Finite split part indices do not match geometry.");
    for (let i = 0; i < mesh.triangles.length; i++) {
      if ((i & 4095) === 0) check();
      const id = mesh.triangles[i];
      if (id * 3 + 2 >= mesh.vertices.length)
        throw new Error("Finite split part indices do not match geometry.");
      for (let axis = 0; axis < 3; axis++) {
        const value = mesh.vertices[id * 3 + axis];
        if (!Number.isFinite(value) || value !== positions[i * 3 + axis])
          throw new Error("Finite split part indices do not match geometry.");
      }
    }
    vertexValues += mesh.vertices.length;
    slots += mesh.triangles.length;
    coordinates += positions.length;
  }
  if (vertexValues / 3 >= 0xffffffff || slots >= 0xffffffff)
    throw new Error("Finite split index capacity exceeded.");
  const bytes = (vertexValues + slots + coordinates) * 4;
  const allowance = options.maxTypedBytes ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(allowance) || allowance < 0 || bytes > allowance)
    throw new Error("Finite split typed memory budget exceeded.");
  const vertices = new Float32Array(vertexValues),
    triangles = new Uint32Array(slots),
    positions = new Float32Array(coordinates);
  let v = 0,
    t = 0,
    p = 0;
  for (let part = 0; part < segments.length; part++) {
    check();
    const mesh = meshes[part];
    vertices.set(mesh.vertices, v);
    positions.set(segments[part], p);
    for (let i = 0; i < mesh.triangles.length; i++) {
      if ((i & 4095) === 0) check();
      triangles[t + i] = mesh.triangles[i] + v / 3;
    }
    v += mesh.vertices.length;
    t += mesh.triangles.length;
    p += segments[part].length;
  }
  check();
  return { positions, indexedMesh: { vertices, triangles } };
}
