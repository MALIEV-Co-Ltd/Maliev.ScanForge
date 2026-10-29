import type { Vec3 } from "./types";
import {
  exactSegmentTriangleCrossing,
  exactEdgeWitnessCrossing,
  type ExactEdgeWitness,
} from "./scan-split-exact-crossing";
type Edge = readonly [number, number];
type Triangle = readonly [number, number, number];
type Contact = {
  edge: Edge;
  t: number;
  fromEnd?: number;
  source?: string;
  exactCutter?: [Vec3, Vec3, Vec3];
  exactWitness?: ExactEdgeWitness;
};
type FaceContact = {
  edge: [number, number];
  points: Vec3[];
  contacts: {
    t: number;
    point: Vec3;
    canonical: {
      t: number;
      reversed: boolean;
      fromEnd?: number;
      exactCutter?: [Vec3, Vec3, Vec3];
      exactWitness?: ExactEdgeWitness;
    };
  }[];
};
const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

type EdgeOptions = {
  selection?: Uint8Array;
  /** The caller publishes selected and unselected faces as separate parts. */
  isolateSelection?: boolean;
  /** Experimental number-array output; not the production Float32 route. */
  preciseCoordinates?: boolean;
  signal?: AbortSignal;
  maxWork?: number;
  check?: () => void;
};
type SourceView = {
  vertexCount: number;
  faceCount: number;
  corner(face: number, slot: number): number;
  faceLength(face: number): number;
  vertex(index: number): Vec3;
};

/** Return only incident faces. Manifold checks cover contacted edges, not the entire mesh. */
export function buildSparseFiniteEdgeContacts(
  vertices: readonly Vec3[],
  faces: readonly Triangle[],
  contacts: readonly Contact[],
  options: EdgeOptions = {},
): Map<number, FaceContact[]> {
  return buildSparseFiniteEdgeContactsFromView(
    {
      vertexCount: vertices.length,
      faceCount: faces.length,
      corner: (face, slot) => faces[face][slot],
      faceLength: (face) => faces[face].length,
      vertex: (index) => vertices[index],
    },
    contacts,
    options,
  );
}

/** Packed source identity; validates contacted edges but does not weld coincident vertices. */
export function buildSparseFiniteEdgeContactsIndexed(
  vertices: ArrayLike<number>,
  triangles: Uint32Array,
  contacts: readonly Contact[],
  options: EdgeOptions = {},
): Map<number, FaceContact[]> {
  if (vertices.length % 3 || triangles.length % 3)
    throw new Error("Finite edge coordinates or indices are incomplete.");
  return buildSparseFiniteEdgeContactsFromView(
    {
      vertexCount: vertices.length / 3,
      faceCount: triangles.length / 3,
      corner: (face, slot) => triangles[face * 3 + slot],
      faceLength: () => 3,
      vertex: (index) => [
        vertices[index * 3],
        vertices[index * 3 + 1],
        vertices[index * 3 + 2],
      ],
    },
    contacts,
    options,
  );
}

function buildSparseFiniteEdgeContactsFromView(
  source: SourceView,
  contacts: readonly Contact[],
  options: EdgeOptions,
): Map<number, FaceContact[]> {
  const limit =
    options.maxWork ?? 2_000_000 + 4 * source.faceCount + 8 * contacts.length;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Finite edge work budget is invalid.");
  let work = 0;
  const tick = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    options.check?.();
    if (++work > limit) throw new Error("Finite edge work budget exceeded.");
  };
  tick();
  if (
    options.selection &&
    (options.selection.length !== source.faceCount ||
      options.selection.some((x) => x !== 0 && x !== 1))
  )
    throw new Error("Finite edge selection is invalid.");
  const valid = (i: number) =>
    Number.isSafeInteger(i) && i >= 0 && i < source.vertexCount;
  const uses = new Map<
    string,
    {
      a: number;
      b: number;
      faces: { index: number; from: number; to: number }[];
      values: {
        t: number;
        fromEnd?: number;
        source?: string;
        exactCutter?: [Vec3, Vec3, Vec3];
        exactWitness?: ExactEdgeWitness;
      }[];
    }
  >();
  const touchedVertices = new Set<number>();
  for (const {
    edge,
    t,
    fromEnd,
    source,
    exactCutter,
    exactWitness,
  } of contacts) {
    tick();
    const [from, to] = edge;
    if (
      !valid(from) ||
      !valid(to) ||
      from === to ||
      !Number.isFinite(t) ||
      t < 0 ||
      t > 1 ||
      (fromEnd !== undefined &&
        (t !== 1 ||
          !Number.isFinite(fromEnd) ||
          fromEnd <= 0 ||
          fromEnd >= 1 ||
          1 - fromEnd !== 1)) ||
      (source !== undefined &&
        (typeof source !== "string" || source.length === 0))
    )
      throw new Error("Finite edge contact is invalid.");
    const k = key(from, to);
    touchedVertices.add(from);
    touchedVertices.add(to);
    const item = uses.get(k) ?? {
      a: Math.min(from, to),
      b: Math.max(from, to),
      faces: [],
      values: [],
    };
    uses.set(k, item);
    const canonical = from === item.a ? t : (fromEnd ?? 1 - t);
    const canonicalFromEnd =
      from === item.a ? fromEnd : canonical === 1 && t > 0 ? t : undefined;
    if ((canonical > 0 && canonical < 1) || canonicalFromEnd !== undefined)
      item.values.push({
        t: canonical,
        fromEnd: canonicalFromEnd,
        source,
        exactCutter,
        exactWitness,
      });
  }
  for (let i = 0; i < source.faceCount; i++) {
    tick();
    const a = source.corner(i, 0),
      b = source.corner(i, 1),
      c = source.corner(i, 2);
    if (
      source.faceLength(i) !== 3 ||
      !valid(a) ||
      !valid(b) ||
      !valid(c) ||
      a === b ||
      b === c ||
      c === a
    )
      throw new Error("Finite edge face indices are invalid.");
    for (let j = 0; j < 3; j++) {
      tick();
      const from = source.corner(i, j),
        to = source.corner(i, (j + 1) % 3);
      if (!touchedVertices.has(from) || !touchedVertices.has(to)) continue;
      const item = uses.get(key(from, to));
      if (!item) continue;
      item.faces.push({ index: i, from, to });
      if (item.faces.length > 2)
        throw new Error("Finite edge is non-manifold.");
    }
  }
  const result = new Map<number, FaceContact[]>();
  for (const item of uses.values()) {
    tick();
    if (!item.faces.length) throw new Error("Finite contact edge is missing.");
    if (!item.values.length) continue;
    if (
      options.selection &&
      !options.isolateSelection &&
      item.faces.some(({ index }) => options.selection![index] === 0)
    )
      throw new Error("Finite cut would subdivide an unselected neighbor.");
    const a = source.vertex(item.a),
      b = source.vertex(item.b);
    if (!a.every(Number.isFinite) || !b.every(Number.isFinite))
      throw new Error("Finite edge coordinates must be finite.");
    item.values.sort(
      (x, y) => x.t - y.t || (y.fromEnd ?? 0) - (x.fromEnd ?? 0),
    );
    const groups: {
      t: number;
      fromEnd?: number;
      sources: Set<string>;
      cutters: [Vec3, Vec3, Vec3][];
      witnesses: ExactEdgeWitness[];
    }[] = [];
    for (const value of item.values) {
      tick();
      let group = groups[groups.length - 1];
      if (!group || group.t !== value.t || group.fromEnd !== value.fromEnd) {
        group = {
          t: value.t,
          fromEnd: value.fromEnd,
          sources: new Set(),
          cutters: [],
          witnesses: [],
        };
        groups.push(group);
      }
      if (value.source !== undefined) group.sources.add(value.source);
      if (value.exactCutter) group.cutters.push(value.exactCutter);
      if (value.exactWitness) group.witnesses.push(value.exactWitness);
    }
    const points: Vec3[] = [];
    const canonicalContacts: {
      t: number;
      fromEnd?: number;
      point: Vec3;
      exactCutter?: [Vec3, Vec3, Vec3];
      exactWitness?: ExactEdgeWitness;
    }[] = [];
    let previous:
      { t: number; fromEnd?: number; sources: Set<string> } | undefined;
    let previousExactIdentity: readonly string[] | undefined;
    for (const value of groups) {
      tick();
      const { t } = value;
      const outputCoordinate = options.preciseCoordinates
        ? (n: number) => n
        : Math.fround;
      let point =
        value.fromEnd === undefined
          ? (a.map((v, i) => outputCoordinate(v + t * (b[i] - v))) as Vec3)
          : (b.map((v, i) =>
              outputCoordinate(v + value.fromEnd! * (a[i] - v)),
            ) as Vec3);
      let exactIdentity: readonly string[] | undefined;
      if (options.preciseCoordinates && value.cutters.length) {
        for (const cutter of value.cutters) {
          tick();
          const crossing = exactSegmentTriangleCrossing(a, b, cutter, {
            exactPoint: true,
          });
          if (
            !crossing?.inside ||
            !crossing.exactPoint ||
            !crossing.roundedPoint ||
            Math.abs(crossing.fraction - t) > 2 * Number.EPSILON
          )
            throw new Error("Finite exact edge contact is inconsistent.");
          if (
            exactIdentity &&
            !exactIdentity.every(
              (coordinate, i) => coordinate === crossing.exactPoint![i],
            )
          )
            throw new Error("Finite exact edge contacts are ambiguous.");
          exactIdentity = crossing.exactPoint;
          point = crossing.roundedPoint;
        }
      }
      if (options.preciseCoordinates)
        for (const witness of value.witnesses) {
          tick();
          const crossing = exactEdgeWitnessCrossing(a, b, witness);
          if (
            Math.abs(crossing.edgeFraction - t) > 2 * Number.EPSILON ||
            (value.fromEnd !== undefined &&
              Math.abs(crossing.edgeOpposite - value.fromEnd) >
                2 * Number.EPSILON)
          )
            throw new Error("Finite exact edge witness is inconsistent.");
          if (
            exactIdentity &&
            !exactIdentity.every(
              (coordinate, i) => coordinate === crossing.exactPoint[i],
            )
          )
            throw new Error("Finite exact edge contacts are ambiguous.");
          exactIdentity = crossing.exactPoint;
          point = crossing.roundedPoint;
        }
      const last = points[points.length - 1];
      if (last && point.every((v, i) => v === last[i])) {
        if (
          options.preciseCoordinates &&
          (exactIdentity || previousExactIdentity) &&
          (!exactIdentity ||
            !previousExactIdentity ||
            !exactIdentity.every(
              (value, i) => value === previousExactIdentity![i],
            ))
        )
          throw new Error(
            "Finite exact edge contacts collapse at output precision.",
          );
        if (
          previous !== undefined &&
          [...value.sources].some((source) => previous!.sources.has(source)) &&
          Math.abs(
            (value.fromEnd ?? 1 - t) - (previous.fromEnd ?? 1 - previous.t),
          ) <=
            2 * Number.EPSILON
        ) {
          for (const source of value.sources) previous.sources.add(source);
          continue;
        }
        throw new Error("Finite edge contacts collapse at output precision.");
      }
      if (
        point.every((v, i) => v === outputCoordinate(a[i])) ||
        point.every((v, i) => v === outputCoordinate(b[i]))
      )
        throw new Error(
          "Finite edge contact collapses to an endpoint at output precision.",
        );
      points.push(point);
      canonicalContacts.push({
        t,
        ...(value.fromEnd === undefined ? {} : { fromEnd: value.fromEnd }),
        ...(options.preciseCoordinates && value.cutters.length
          ? { exactCutter: value.cutters[0] }
          : {}),
        ...(options.preciseCoordinates && value.witnesses.length
          ? { exactWitness: value.witnesses[0] }
          : {}),
        point,
      });
      previous = value;
      previousExactIdentity = exactIdentity;
    }
    for (const f of item.faces) {
      tick();
      if (options.isolateSelection && options.selection?.[f.index] === 0)
        continue;
      const faceContacts = result.get(f.index) ?? [];
      faceContacts.push({
        edge: [f.from, f.to],
        points: (f.from === item.a ? points : [...points].reverse()).map(
          (p) => [...p] as Vec3,
        ),
        contacts:
          f.from === item.a
            ? canonicalContacts.map(
                ({ t, fromEnd, point, exactCutter, exactWitness }) => ({
                  t,
                  point: [...point] as Vec3,
                  canonical: {
                    t,
                    reversed: false,
                    ...(fromEnd === undefined ? {} : { fromEnd }),
                    ...(exactCutter ? { exactCutter } : {}),
                    ...(exactWitness ? { exactWitness } : {}),
                  },
                }),
              )
            : canonicalContacts
                .map(({ t, fromEnd, point, exactCutter, exactWitness }) => ({
                  t: fromEnd ?? 1 - t,
                  point: [...point] as Vec3,
                  canonical: {
                    t,
                    reversed: true,
                    ...(fromEnd === undefined ? {} : { fromEnd }),
                    ...(exactCutter ? { exactCutter } : {}),
                    ...(exactWitness ? { exactWitness } : {}),
                  },
                }))
                .reverse(),
      });
      result.set(f.index, faceContacts);
    }
  }
  for (const [faceIndex, entries] of result) {
    tick();
    entries.sort((left, right) => {
      const index = (id: number) =>
        source.corner(faceIndex, 0) === id
          ? 0
          : source.corner(faceIndex, 1) === id
            ? 1
            : 2;
      return index(left.edge[0]) - index(right.edge[0]);
    });
  }
  return new Map([...result].sort(([a], [b]) => a - b));
}

/** Dense adapter for small callers. Large meshes should consume the sparse result. */
export function buildFiniteEdgeContacts(
  vertices: readonly Vec3[],
  faces: readonly Triangle[],
  contacts: readonly Contact[],
  options: EdgeOptions = {},
): FaceContact[][] {
  const sparse = buildSparseFiniteEdgeContacts(
    vertices,
    faces,
    contacts,
    options,
  );
  return Array.from({ length: faces.length }, (_, i) => sparse.get(i) ?? []);
}
