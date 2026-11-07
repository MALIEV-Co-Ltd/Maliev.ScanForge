/** Exact Float32-output normalization. Does not repair intersections or infer holes. */
export function normalizePoissonMesh(
  vertices: Float32Array,
  triangles: Uint32Array,
  density: Float32Array,
  densityThreshold = 0,
) {
  const count = vertices.length / 3;
  if (
    !Number.isInteger(count) ||
    count < 3 ||
    count > 2_000_000 ||
    triangles.length % 3 ||
    triangles.length < 3 ||
    triangles.length > 12_000_000 ||
    density.length !== count ||
    !vertices.every(Number.isFinite) ||
    !density.every(Number.isFinite) ||
    triangles.some((i) => i >= count) ||
    !Number.isFinite(densityThreshold) ||
    densityThreshold < 0 ||
    densityThreshold > 32
  )
    throw Error("Poisson returned invalid coordinates, density or topology.");
  const coordinateIds = new Map<string, number>();
  const aliases = new Uint32Array(count);
  density = density.slice();
  let mergedVertices = 0;
  for (let i = 0; i < count; i++) {
    const key = `${vertices[i * 3]},${vertices[i * 3 + 1]},${vertices[i * 3 + 2]}`;
    const previous = coordinateIds.get(key);
    if (previous === undefined) {
      coordinateIds.set(key, i);
      aliases[i] = i;
    } else {
      aliases[i] = previous;
      density[previous] = Math.min(density[previous], density[i]);
      mergedVertices++;
    }
  }
  triangles = triangles.map((index) => aliases[index]);
  let removedDegenerateTriangles = 0,
    removedDuplicateTriangles = 0,
    trimmedTriangles = 0;
  const retained: number[] = [],
    seen = new Set<string>();
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i],
      b = triangles[i + 1],
      c = triangles[i + 2];
    const ux = vertices[b * 3] - vertices[a * 3],
      uy = vertices[b * 3 + 1] - vertices[a * 3 + 1],
      uz = vertices[b * 3 + 2] - vertices[a * 3 + 2],
      vx = vertices[c * 3] - vertices[a * 3],
      vy = vertices[c * 3 + 1] - vertices[a * 3 + 1],
      vz = vertices[c * 3 + 2] - vertices[a * 3 + 2];
    if (
      a === b ||
      a === c ||
      b === c ||
      (uy * vz - uz * vy === 0 &&
        uz * vx - ux * vz === 0 &&
        ux * vy - uy * vx === 0)
    ) {
      removedDegenerateTriangles++;
      continue;
    }
    const key = [a, b, c].sort((x, y) => x - y).join(",");
    if (seen.has(key)) {
      removedDuplicateTriangles++;
      continue;
    }
    seen.add(key);
    if (
      density[a] < densityThreshold ||
      density[b] < densityThreshold ||
      density[c] < densityThreshold
    ) {
      trimmedTriangles++;
      continue;
    }
    retained.push(a, b, c);
  }
  if (!retained.length)
    throw Error(
      "Normalization or density trimming removed the entire Poisson surface; lower densityThreshold or inspect the cloud.",
    );
  const remap = new Int32Array(count).fill(-1),
    compact: number[] = [],
    compactDensity: number[] = [];
  const outputTriangles = Uint32Array.from(retained, (index) => {
    if (remap[index] === -1) {
      remap[index] = compactDensity.length;
      compact.push(
        vertices[index * 3],
        vertices[index * 3 + 1],
        vertices[index * 3 + 2],
      );
      compactDensity.push(density[index]);
    }
    return remap[index];
  });
  return {
    vertices: Float32Array.from(compact),
    triangles: outputTriangles,
    density: Float32Array.from(compactDensity),
    mergedVertices,
    removedDegenerateTriangles,
    removedDuplicateTriangles,
    trimmedTriangles,
  };
}
