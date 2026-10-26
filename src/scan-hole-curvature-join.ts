import { analyzeIndexedMesh, type MeshTopology } from "./mesh-processing";
import { nativeReferenceNormalize } from "./reference-geometry-numerics";
import { nativeGlobalCosine } from "./scan-native-global-trig";
import { smoothNativeCurvatureCollar } from "./scan-hole-curvature-smooth";
import type { Vec3 } from "./types";

interface CurvatureJoinInput {
  boundary: readonly number[];
  boundaryUV: readonly (readonly number[])[];
  boundaryWorld: readonly (readonly number[])[];
  cap: { vertices: Float32Array; uvs: Float32Array; triangles: Uint32Array };
}
interface Face {
  ids: [number, number, number];
  selected: boolean;
  deleted: boolean;
}
interface EdgeUse {
  face: number;
  corner: number;
  from: number;
  to: number;
}
const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const maximumRecords = 1_000_000;

/** Stitch, simplify and smooth one private Curvature cap without mutating inputs. */
export function joinNativeCurvaturePatch(
  source: MeshTopology,
  input: CurvatureJoinInput,
  check?: () => void,
): {
  vertices: Float32Array;
  triangles: Uint32Array;
  stitchedBoundaryVertices: number;
  collapsedEdges: number;
} {
  check?.();
  const { boundary, boundaryUV, boundaryWorld, cap } = input;
  const budget = () =>
    new Error("Curvature collar exceeds its resource budget.");
  const invalid = () =>
    new Error("Curvature requires a matching exposed closed boundary.");
  if (
    source.vertices.length / 3 + cap.vertices.length / 3 > maximumRecords ||
    source.triangles.length / 3 + cap.triangles.length / 3 > maximumRecords
  )
    throw budget();
  if (
    boundary.length < 3 ||
    new Set(boundary).size !== boundary.length ||
    boundaryUV.length !== boundary.length ||
    boundaryWorld.length !== boundary.length
  )
    throw invalid();
  if (source.nonManifoldEdges || source.inconsistentEdges)
    throw new Error(
      "Curvature collar must have manifold edges and consistent winding.",
    );
  const point = (p: readonly number[], uv = false): Vec3 => {
    if (p.length !== 3 || !p.every(Number.isFinite) || (uv && p[2] !== 0))
      throw new Error(
        "Curvature requires finite XYZ and planar UV coordinates.",
      );
    const out = p.map(Math.fround) as Vec3;
    if (!out.every(Number.isFinite))
      throw new Error("Curvature coordinates exceed Float32 precision.");
    return out;
  };
  const points: Vec3[] = [];
  for (let id = 0; id < source.vertices.length / 3; id++) {
    if (id % 4096 === 0) check?.();
    points.push(point(Array.from(source.vertices.slice(id * 3, id * 3 + 3))));
  }
  const incident = boundary.map((a, i) => {
    if (!Number.isInteger(a) || a < 0 || a >= points.length) throw invalid();
    const uses = source.edges.get(key(a, boundary[(i + 1) % boundary.length]));
    if (uses?.length !== 1) throw invalid();
    point(boundaryUV[i], true);
    points[a] = point(boundaryWorld[i]);
    return uses[0].face;
  });
  if (
    cap.vertices.length !== cap.uvs.length ||
    cap.vertices.length % 3 ||
    cap.triangles.length % 3 ||
    !cap.triangles.length
  )
    throw new Error(
      "Curvature cap requires matching UV and world vertices and complete facets.",
    );
  const capCount = cap.vertices.length / 3;
  for (let id = 0; id < capCount; id++) {
    if (id % 4096 === 0) check?.();
    point(Array.from(cap.vertices.slice(id * 3, id * 3 + 3)));
    point(Array.from(cap.uvs.slice(id * 3, id * 3 + 3)), true);
  }
  const capTopology = analyzeIndexedMesh(
    Float64Array.from(cap.uvs),
    cap.triangles,
  );
  if (
    capTopology.nonManifoldEdges ||
    capTopology.inconsistentEdges ||
    capTopology.nonManifoldVertices ||
    capTopology.boundaryChains.length ||
    capTopology.boundaryLoops.length !== 1
  )
    throw new Error(
      "Curvature cap must be a consistently wound manifold disk.",
    );
  const exposed = new Uint8Array(capCount);
  for (const uses of capTopology.edges.values())
    if (uses.length === 1) exposed[uses[0].from] = exposed[uses[0].to] = 1;
  const remap = new Int32Array(capCount).fill(-1);
  for (let i = 0; i < boundary.length; i++) {
    check?.();
    let best = -1,
      distance = Number.MAX_VALUE;
    for (let id = 0; id < capCount; id++) {
      if (!exposed[id]) continue;
      let squared = 0;
      for (let a = 0; a < 3; a++)
        squared += (boundaryUV[i][a] - cap.uvs[id * 3 + a]) ** 2;
      if (squared < distance) {
        distance = squared;
        best = id;
      }
    }
    if (best < 0 || remap[best] >= 0)
      throw new Error(
        "Curvature cap requires distinct original rim counterparts.",
      );
    remap[best] = boundary[i];
  }
  const inserted = Array<number>(points.length).fill(0);
  const seams = boundary.map(() => new Map<number, number>());
  function project(
    p: readonly number[],
    a: readonly number[],
    b: readonly number[],
  ) {
    const d = a.map((v, axis) => b[axis] - v);
    const squared = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const t =
      squared <= Math.fround(1e-6)
        ? 0
        : (d[0] * (p[0] - a[0]) + d[1] * (p[1] - a[1]) + d[2] * (p[2] - a[2])) /
          squared;
    const clamped = Math.max(0, Math.min(1, t));
    const delta = a.map((v, axis) => p[axis] - (v + clamped * d[axis]));
    return {
      t,
      distance: Math.sqrt(delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2),
    };
  }
  for (let id = 0; id < capCount; id++) {
    if (id % 4096 === 0) check?.();
    if (remap[id] >= 0) continue;
    remap[id] = points.length;
    points.push(point(Array.from(cap.vertices.slice(id * 3, id * 3 + 3))));
    inserted.push(exposed[id]);
    if (!exposed[id]) continue;
    const uv = Array.from(cap.uvs.slice(id * 3, id * 3 + 3));
    let best = -1,
      distance = Number.MAX_VALUE,
      parameter = 0;
    for (let i = 0; i < boundary.length; i++) {
      const result = project(
        uv,
        boundaryUV[i],
        boundaryUV[(i + 1) % boundary.length],
      );
      if (Math.abs(result.distance) < distance) {
        best = i;
        distance = Math.abs(result.distance);
        parameter = result.t;
      }
    }
    if (best < 0) throw invalid();
    seams[best].set(parameter, remap[id]);
  }
  const faces: Face[] = [];
  for (let offset = 0; offset < source.triangles.length; offset += 3)
    faces.push({
      ids: Array.from(
        source.triangles.slice(offset, offset + 3),
      ) as Face["ids"],
      selected: false,
      deleted: false,
    });
  const groups = new Map<number, Face[]>();
  for (const face of incident)
    if (!groups.has(face)) groups.set(face, [faces[face]]);
  for (let offset = 0; offset < cap.triangles.length; offset += 3) {
    const ids = Array.from(cap.triangles.slice(offset, offset + 3)).map(
      (id) => remap[id],
    ) as Face["ids"];
    if (ids.some((id) => id === undefined || id < 0))
      throw new Error("Curvature cap index is out of range.");
    faces.push({ ids, selected: false, deleted: false });
  }
  let stitchedBoundaryVertices = 0;
  for (let i = 0; i < boundary.length; i++) {
    check?.();
    const a = boundary[i],
      b = boundary[(i + 1) % boundary.length],
      group = groups.get(incident[i])!;
    const face = group.find(
      (face) => !face.deleted && face.ids.includes(a) && face.ids.includes(b),
    );
    if (!face) throw invalid();
    const middle = [...seams[i]]
      .sort((a, b) => a[0] - b[0])
      .map(([, id]) => id);
    if (!middle.length) {
      face.selected = true;
      continue;
    }
    stitchedBoundaryVertices += middle.length;
    let start = a,
      end = b,
      corner = face.ids.indexOf(a);
    if (face.ids[(corner + 1) % 3] !== b) {
      start = b;
      end = a;
      middle.reverse();
      corner = face.ids.indexOf(b);
    }
    const opposite = face.ids[(corner + 2) % 3],
      chain = [start, ...middle, end];
    if (faces.length + chain.length - 1 > maximumRecords) throw budget();
    for (let j = 0; j < chain.length - 1; j++) {
      const added: Face = {
        ids: [opposite, chain[j], chain[j + 1]],
        selected: true,
        deleted: false,
      };
      faces.push(added);
      group.push(added);
    }
    face.deleted = true;
  }
  function removeDeleted() {
    for (let i = 0; i < faces.length;) {
      if (i % 4096 === 0) check?.();
      if (!faces[i].deleted && new Set(faces[i].ids).size === 3) {
        i++;
        continue;
      }
      const last = faces.pop()!;
      if (i < faces.length) faces[i] = last;
    }
  }
  removeDeleted();
  const edges = new Map<string, EdgeUse[]>(),
    vertexFaces = new Map<number, Set<number>>();
  function record(index: number, add: boolean) {
    const face = faces[index];
    for (let corner = 0; corner < 3; corner++) {
      const from = face.ids[corner],
        to = face.ids[(corner + 1) % 3],
        edge = key(from, to);
      if (add) {
        const uses = edges.get(edge) ?? [];
        if (uses.length >= 2 || uses.some((use) => use.from === from))
          throw new Error(
            "Curvature seam would create nonmanifold edges or inconsistent winding.",
          );
        uses.push({ face: index, corner, from, to });
        edges.set(edge, uses);
        const incidence = vertexFaces.get(from) ?? new Set<number>();
        incidence.add(index);
        vertexFaces.set(from, incidence);
      } else {
        const uses = (edges.get(edge) ?? []).filter(
          (use) => use.face !== index,
        );
        if (uses.length) edges.set(edge, uses);
        else edges.delete(edge);
        const incidence = vertexFaces.get(from);
        incidence?.delete(index);
        if (!incidence?.size) vertexFaces.delete(from);
      }
    }
  }
  function rebuild() {
    edges.clear();
    vertexFaces.clear();
    for (let index = 0; index < faces.length; index++) {
      if (index % 4096 === 0) check?.();
      if (!faces[index].deleted) record(index, true);
    }
  }
  rebuild();
  function difference(a: Vec3, b: Vec3) {
    return a.map((value, axis) => Math.fround(value - b[axis]));
  }
  function normal(ids: Face["ids"], corner: number) {
    const u = difference(points[ids[(corner + 1) % 3]], points[ids[corner]]);
    const v = difference(points[ids[(corner + 2) % 3]], points[ids[corner]]);
    return [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
  }
  const cosine = nativeGlobalCosine(Math.PI / 6);
  let collapsedEdges = 0,
    work = 0;
  for (let index = 0; index < faces.length; index++) {
    if (index % 128 === 0) check?.();
    const face = faces[index];
    if (face.deleted || !face.selected) continue;
    for (let corner = 0; corner < 3; corner++) {
      const keep = face.ids[corner],
        remove = face.ids[(corner + 1) % 3],
        apex = face.ids[(corner + 2) % 3];
      if (!inserted[keep] || !inserted[remove]) continue;
      const adjacent = edges
        .get(key(keep, remove))
        ?.find((use) => use.face !== index);
      if (!adjacent || faces[adjacent.face].selected) continue;
      const a = nativeReferenceNormalize(
        difference(points[keep], points[apex]),
      );
      const b = nativeReferenceNormalize(
        difference(points[remove], points[apex]),
      );
      if (!(cosine <= b[1] * a[1] + b[0] * a[0] + b[2] * a[2])) continue;
      const affected = [...(vertexFaces.get(remove) ?? [])],
        changed = new Map<number, Face["ids"]>();
      work += affected.length * 12;
      if (work > 250_000_000) throw budget();
      let accepted = true;
      for (const id of affected) {
        if (id === index || id === adjacent.face) continue;
        const before = faces[id].ids,
          at = before.indexOf(remove);
        const after = before.map((vertex) =>
          vertex === remove ? keep : vertex,
        ) as Face["ids"];
        const oldNormal = nativeReferenceNormalize(normal(before, at)),
          raw = normal(after, at);
        const squared = raw[1] * raw[1] + raw[0] * raw[0] + raw[2] * raw[2];
        const newNormal = nativeReferenceNormalize(raw);
        if (
          squared < 0.0001 ||
          newNormal[1] * oldNormal[1] +
            newNormal[0] * oldNormal[0] +
            newNormal[2] * oldNormal[2] <
            0
        ) {
          accepted = false;
          break;
        }
        changed.set(id, after);
      }
      if (!accepted) continue;
      const affectedSet = new Set(affected),
        proposed = new Map<string, EdgeUse[]>();
      for (const [id, ids] of changed) {
        for (let c = 0; c < 3; c++) {
          const from = ids[c],
            to = ids[(c + 1) % 3],
            edge = key(from, to);
          const uses =
            proposed.get(edge) ??
            (edges.get(edge) ?? []).filter((use) => !affectedSet.has(use.face));
          if (uses.length >= 2 || uses.some((use) => use.from === from)) {
            accepted = false;
            break;
          }
          uses.push({ face: id, corner: c, from, to });
          proposed.set(edge, uses);
        }
        if (!accepted) break;
      }
      if (!accepted) continue;
      for (const id of affected) record(id, false);
      faces[index].deleted = faces[adjacent.face].deleted = true;
      for (const [id, ids] of changed) {
        faces[id].ids = ids;
        record(id, true);
      }
      collapsedEdges++;
      break;
    }
  }
  removeDeleted();
  rebuild();
  for (let pass = 0; pass < 4; pass++) {
    check?.();
    const next = Uint8Array.from(faces, (face) => Number(face.selected));
    for (let index = 0; index < faces.length; index++) {
      if (!faces[index].selected) continue;
      const ids = faces[index].ids;
      for (let corner = 0; corner < 3; corner++)
        for (const use of edges.get(key(ids[corner], ids[(corner + 1) % 3])) ??
          [])
          next[use.face] = 1;
    }
    for (let index = 0; index < faces.length; index++)
      faces[index].selected = next[index] === 1;
  }
  const triangles = Uint32Array.from(faces.flatMap((face) => face.ids));
  const topology = analyzeIndexedMesh(
    Float64Array.from(points.flat()),
    triangles,
  );
  if (
    topology.nonManifoldEdges ||
    topology.inconsistentEdges ||
    topology.boundaryChains.length !== source.boundaryChains.length ||
    topology.boundaryLoops.length !== source.boundaryLoops.length - 1
  )
    throw new Error(
      "Curvature seam did not close exactly the requested boundary.",
    );
  const selected = new Uint8Array(points.length);
  for (const face of faces)
    if (face.selected) for (const id of face.ids) selected[id] = 1;
  const smoothed = smoothNativeCurvatureCollar(topology, selected, 2, check);
  // Keep source identities, but never publish orphaned temporary cap records.
  const sourceCount = source.vertices.length / 3;
  const used = new Uint8Array(points.length);
  for (const id of triangles) used[id] = 1;
  const compact = new Int32Array(points.length).fill(-1);
  let count = 0;
  for (let id = 0; id < points.length; id++)
    if (id < sourceCount || used[id]) compact[id] = count++;
  const vertices = new Float32Array(count * 3);
  for (let id = 0; id < points.length; id++) {
    if (id % 4096 === 0) check?.();
    if (compact[id] >= 0)
      vertices.set(smoothed.subarray(id * 3, id * 3 + 3), compact[id] * 3);
  }
  for (let corner = 0; corner < triangles.length; corner++)
    triangles[corner] = compact[triangles[corner]];
  check?.();
  return { vertices, triangles, stitchedBoundaryVertices, collapsedEdges };
}
