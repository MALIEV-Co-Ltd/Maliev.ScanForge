import type { Vec3 } from "./types";
import type { ExactEdgeWitness } from "./scan-split-exact-crossing";

type Hit = {
  points: Vec3[];
  coplanar: boolean;
  sourceEdges: { edge: number; t: number; fromEnd?: number }[][];
};
type RegisteredEdge = {
  edge: [number, number];
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
type Boundary = {
  edge: 0 | 1 | 2;
  t: number;
  point: Vec3;
  canonical: {
    t: number;
    reversed: boolean;
    fromEnd?: number;
    exactCutter?: [Vec3, Vec3, Vec3];
    exactWitness?: ExactEdgeWitness;
  };
};

/** Translate finite hits and indexed-edge contacts into local triangulation inputs. */
export function buildFiniteFaceInput(
  ids: readonly [number, number, number],
  hits: readonly Hit[],
  registered: readonly RegisteredEdge[],
  options: {
    signal?: AbortSignal;
    maxWork?: number;
    check?: () => void;
    preciseCoordinates?: boolean;
  } = {},
) {
  const limit =
    options.maxWork ?? 2_000_000 + hits.length * 32 + registered.length * 32;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Finite face input work budget is invalid.");
  let work = 0;
  const tick = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    options.check?.();
    if (++work > limit)
      throw new Error("Finite face input work budget exceeded.");
  };
  tick();
  if (
    new Set(ids).size !== 3 ||
    !ids.every((n) => Number.isSafeInteger(n) && n >= 0)
  )
    throw new Error("Finite face source indices are invalid.");
  const boundaryContacts: Boundary[] = [];
  const byEdge: number[][] = [[], [], []];
  for (const record of registered) {
    tick();
    const edge = ids.findIndex(
      (id, i) => id === record.edge[0] && ids[(i + 1) % 3] === record.edge[1],
    );
    if (edge < 0)
      throw new Error("Finite contact does not belong to the source face.");
    for (const c of record.contacts) {
      tick();
      if (!Number.isFinite(c.t))
        throw new Error("Finite contact parameter is invalid.");
      byEdge[edge].push(boundaryContacts.length);
      boundaryContacts.push({
        edge: edge as 0 | 1 | 2,
        t: c.t,
        point: [...c.point],
        canonical: { ...c.canonical },
      });
    }
  }
  for (const indices of byEdge)
    indices.sort((a, b) => {
      tick();
      return boundaryContacts[a].t - boundaryContacts[b].t;
    });
  const segments: [Vec3, Vec3][] = [];
  const endpointBindings: {
    segment: number;
    endpoint: 0 | 1;
    contact: number;
  }[] = [];
  for (const hit of hits) {
    tick();
    if (
      hit.points.length !== hit.sourceEdges.length ||
      hit.points.length > (hit.coplanar ? 6 : 2)
    )
      throw new Error("Finite intersection metadata is invalid.");
    if (hit.coplanar || hit.points.length !== 2) continue;
    const segment = segments.length;
    segments.push([[...hit.points[0]], [...hit.points[1]]]);
    for (const endpoint of [0, 1] as const) {
      tick();
      let binding: number | undefined;
      for (const { edge, t, fromEnd } of hit.sourceEdges[endpoint]) {
        tick();
        if (
          !Number.isInteger(edge) ||
          edge < 0 ||
          edge > 2 ||
          !Number.isFinite(t) ||
          t < 0 ||
          t > 1 ||
          (fromEnd !== undefined &&
            (t !== 1 ||
              !Number.isFinite(fromEnd) ||
              fromEnd <= 0 ||
              fromEnd >= 1 ||
              1 - fromEnd !== 1))
        )
          throw new Error("Finite intersection edge provenance is invalid.");
        if (t === 0 || (t === 1 && fromEnd === undefined)) continue;
        const indices = byEdge[edge];
        const tolerance = 2 * Number.EPSILON;
        let low = 0,
          high = indices.length;
        while (low < high) {
          tick();
          const middle = Math.floor((low + high) / 2);
          if (boundaryContacts[indices[middle]].t < t - tolerance)
            low = middle + 1;
          else high = middle;
        }
        let match: number | undefined;
        let ambiguous = false;
        let exact: number | undefined;
        let exactAmbiguous = false;
        for (
          let i = low;
          i < indices.length && boundaryContacts[indices[i]].t <= t + tolerance;
          i++
        ) {
          tick();
          const index = indices[i],
            contact = boundaryContacts[index];
          if (
            contact.point.every(
              (n, k) => Math.fround(n) === Math.fround(hit.points[endpoint][k]),
            )
          ) {
            if (match !== undefined) ambiguous = true;
            else match = index;
            if (
              options.preciseCoordinates &&
              fromEnd === undefined &&
              contact.t === t
            ) {
              if (exact !== undefined) exactAmbiguous = true;
              else exact = index;
            }
          }
        }
        if (exact !== undefined && !exactAmbiguous) {
          match = exact;
          ambiguous = false;
        }
        if (
          match === undefined ||
          ambiguous ||
          (binding !== undefined && binding !== match)
        )
          throw new Error(
            "Finite intersection contact is missing or ambiguous.",
          );
        binding = match;
      }
      if (binding !== undefined)
        endpointBindings.push({ segment, endpoint, contact: binding });
    }
  }
  return { segments, boundaryContacts, endpointBindings };
}
