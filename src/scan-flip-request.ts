import { indexedMeshMatches } from "./indexed-mesh";
import { yieldScanTask } from "./scan-task";
import type { Entity, IndexedMesh, Positions } from "./types";

const CHUNK = 65_536;

function sourceMesh(entity: Entity): IndexedMesh | undefined {
  const mesh = entity.indexedMesh;
  if (mesh && mesh.vertices.length > 27_000_000)
    throw new Error(
      "Indexed vertices exceed the Flip Normals processing limit.",
    );
  return mesh;
}

function bind(mesh: IndexedMesh): IndexedMesh {
  return {
    vertices: mesh.vertices,
    triangles: mesh.triangles,
    ...(mesh.facetNormals ? { facetNormals: mesh.facetNormals } : {}),
  };
}

/** Synchronous compatibility for callers that do not schedule work. */
export function flipSourceTopologySync(
  entity: Entity,
): IndexedMesh | undefined {
  const mesh = sourceMesh(entity);
  return indexedMeshMatches(mesh, entity.positions) ? bind(mesh) : undefined;
}

/** Validate workspace topology in interruptible tasks before worker transport. */
export async function flipSourceTopology(
  entity: Entity,
  check: () => void = () => {},
): Promise<IndexedMesh | undefined> {
  check();
  const mesh = sourceMesh(entity);
  if (!mesh) return undefined;
  const { vertices, triangles, normals, geometryNormals, facetNormals } = mesh;
  if (
    !(Array.isArray(vertices) || vertices instanceof Float32Array) ||
    !(Array.isArray(triangles) || triangles instanceof Uint32Array) ||
    !vertices.length ||
    vertices.length % 3 ||
    !triangles.length ||
    triangles.length % 3 ||
    triangles.length * 3 !== entity.positions.length ||
    (normals !== undefined &&
      (!(Array.isArray(normals) || normals instanceof Float32Array) ||
        normals.length !== vertices.length)) ||
    (geometryNormals !== undefined &&
      (!(
        Array.isArray(geometryNormals) ||
        geometryNormals instanceof Float32Array
      ) ||
        geometryNormals.length !== vertices.length)) ||
    (facetNormals !== undefined &&
      (!(Array.isArray(facetNormals) || facetNormals instanceof Float32Array) ||
        facetNormals.length !== triangles.length))
  )
    return undefined;

  async function visit(
    length: number,
    run: (first: number, end: number) => boolean,
  ) {
    for (let first = 0; first < length; first += CHUNK) {
      check();
      if (!run(first, Math.min(first + CHUNK, length))) return false;
      if (first + CHUNK < length) await yieldScanTask();
    }
    check();
    return true;
  }
  async function finite(
    values: Positions,
    requireFloat32: boolean,
    skipHoles: boolean,
  ) {
    return visit(values.length, (first, end) => {
      for (let i = first; i < end; i++) {
        if (skipHoles && !(i in values)) continue;
        const value = values[i];
        if (
          !Number.isFinite(value) ||
          (requireFloat32 && !Number.isFinite(Math.fround(value)))
        )
          return false;
      }
      return true;
    });
  }
  if (
    !(await finite(vertices, false, true)) ||
    (normals && !(await finite(normals, false, true))) ||
    (geometryNormals && !(await finite(geometryNormals, true, false))) ||
    (facetNormals && !(await finite(facetNormals, true, false)))
  )
    return undefined;
  const matches = await visit(triangles.length, (first, end) => {
    for (let slot = first; slot < end; slot++) {
      const id = triangles[slot];
      if (!Number.isSafeInteger(id) || id < 0 || id * 3 >= vertices.length)
        return false;
      for (let axis = 0; axis < 3; axis++)
        if (vertices[id * 3 + axis] !== entity.positions[slot * 3 + axis])
          return false;
    }
    return true;
  });
  return matches ? bind(mesh) : undefined;
}
