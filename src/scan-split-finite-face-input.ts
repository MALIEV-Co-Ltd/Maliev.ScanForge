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
    maxLookupEntries?: number;
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
  const associationRadius = Math.fround(0.0001);
  const lookupLimit = options.maxLookupEntries ?? 1_048_576;
  if (!Number.isSafeInteger(lookupLimit) || lookupLimit < 0)
    throw new Error("Finite contact lookup memory budget is invalid.");
  let lookupEntries = 0;
  const reserveLookup = () => {
    if (++lookupEntries > lookupLimit)
      throw new Error("Finite contact lookup memory budget exceeded.");
  };
  type Bucket = {
    indices: number[];
    min: number[];
    max: number[];
    a?: number[];
    b?: number[];
    deviation?: number;
    margin?: number;
    unit?: number[];
    sorted?: { index: number; projection: number }[];
  };
  const distanceToSegment = (p: number[], a: number[], b: number[]) => {
    const u = b.map((v, i) => v - a[i]);
    const length2 = u.reduce((sum, v) => sum + v * v, 0);
    const t =
      length2 === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              u.reduce((sum, v, i) => sum + v * (p[i] - a[i]), 0) / length2,
            ),
          );
    return Math.hypot(...p.map((v, i) => v - (a[i] + t * u[i])));
  };
  let contactBuckets: Map<string, Bucket> | undefined;
  const lookupCache = new Map<string, number | null>();
  const roundedCell = (p: number[]) =>
    p.map((v) => Math.floor(v / associationRadius));
  const cellKey = (x: number, y: number, z: number) => `${x}:${y}:${z}`;
  const uniqueNearby = (p: Vec3): number | undefined => {
    if (boundaryContacts.length === 0) return undefined;
    const rounded = p.map(Math.fround);
    if (!rounded.every(Number.isFinite)) return undefined;
    const cacheKey = rounded.join(":");
    const cached = lookupCache.get(cacheKey);
    if (cached !== undefined) return cached === null ? undefined : cached;
    if (!contactBuckets) {
      contactBuckets = new Map();
      for (let i = 0; i < boundaryContacts.length; i++) {
        tick();
        const coords = boundaryContacts[i].point.map(Math.fround);
        const cell = roundedCell(coords);
        if (!cell.every(Number.isFinite)) continue;
        const key = `${cellKey(cell[0], cell[1], cell[2])}:${boundaryContacts[i].edge}`;
        let bucket = contactBuckets.get(key);
        if (!bucket) {
          reserveLookup();
          bucket = { indices: [], min: [...coords], max: [...coords] };
          contactBuckets.set(key, bucket);
        }
        reserveLookup();
        bucket.indices.push(i);
        for (let axis = 0; axis < 3; axis++) {
          bucket.min[axis] = Math.min(bucket.min[axis], coords[axis]);
          bucket.max[axis] = Math.max(bucket.max[axis], coords[axis]);
        }
      }
      for (const bucket of contactBuckets.values()) {
        tick();
        const axis = [0, 1, 2].reduce(
          (best, k) =>
            bucket.max[k] - bucket.min[k] > bucket.max[best] - bucket.min[best]
              ? k
              : best,
          0,
        );
        let low = bucket.indices[0],
          high = low;
        for (const i of bucket.indices) {
          tick();
          if (
            Math.fround(boundaryContacts[i].point[axis]) <
            Math.fround(boundaryContacts[low].point[axis])
          )
            low = i;
          if (
            Math.fround(boundaryContacts[i].point[axis]) >
            Math.fround(boundaryContacts[high].point[axis])
          )
            high = i;
        }
        bucket.a = boundaryContacts[low].point.map(Math.fround);
        bucket.b = boundaryContacts[high].point.map(Math.fround);
        bucket.deviation = 0;
        for (const i of bucket.indices) {
          tick();
          bucket.deviation = Math.max(
            bucket.deviation,
            distanceToSegment(
              boundaryContacts[i].point.map(Math.fround),
              bucket.a,
              bucket.b,
            ),
          );
        }
        bucket.margin =
          64 *
          Number.EPSILON *
          Math.max(1, ...bucket.min.map(Math.abs), ...bucket.max.map(Math.abs));
        const vector = bucket.b.map((v, k) => v - bucket.a![k]);
        const length = Math.hypot(...vector);
        if (length > 0) {
          bucket.unit = vector.map((v) => v / length);
          bucket.sorted = bucket.indices.map((index) => {
            tick();
            reserveLookup();
            const point = boundaryContacts[index].point;
            return {
              index,
              projection: point.reduce(
                (sum, v, k) =>
                  sum + (Math.fround(v) - bucket.a![k]) * bucket.unit![k],
                0,
              ),
            };
          });
          bucket.sorted.sort((a, b) => {
            tick();
            return a.projection - b.projection;
          });
        }
      }
    }
    const center = roundedCell(rounded);
    const keys = new Set<string>();
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (let edge = 0; edge < 3; edge++)
            keys.add(
              `${cellKey(center[0] + dx, center[1] + dy, center[2] + dz)}:${edge}`,
            );
    let candidate: number | undefined;
    let ambiguous = false;
    for (const key of keys) {
      const bucket = contactBuckets.get(key);
      if (!bucket) continue;
      const minDistance = Math.hypot(
        ...rounded.map((v, axis) =>
          Math.max(bucket.min[axis] - v, 0, v - bucket.max[axis]),
        ),
      );
      if (minDistance - bucket.margin! >= associationRadius) continue;
      const lineDistance = distanceToSegment(rounded, bucket.a!, bucket.b!);
      if (
        lineDistance - bucket.deviation! - bucket.margin! >=
        associationRadius
      )
        continue;
      let candidates: Iterable<number> = bucket.indices;
      if (bucket.unit && bucket.sorted) {
        const projection = rounded.reduce(
          (sum, v, k) => sum + (v - bucket.a![k]) * bucket.unit![k],
          0,
        );
        const perpendicular = Math.hypot(
          ...rounded.map(
            (v, k) => v - (bucket.a![k] + projection * bucket.unit![k]),
          ),
        );
        const minPerpendicular = Math.max(
          0,
          perpendicular - bucket.deviation! - bucket.margin!,
        );
        const paddedRadius = associationRadius + bucket.margin!;
        if (minPerpendicular >= paddedRadius) continue;
        const span =
          Math.sqrt(
            Math.max(
              0,
              paddedRadius * paddedRadius - minPerpendicular * minPerpendicular,
            ),
          ) +
          2 * bucket.margin!;
        let lo = 0,
          hi = bucket.sorted.length;
        while (lo < hi) {
          tick();
          const mid = Math.floor((lo + hi) / 2);
          if (bucket.sorted[mid].projection < projection - span) lo = mid + 1;
          else hi = mid;
        }
        const sorted = bucket.sorted;
        candidates = (function* () {
          for (
            let i = lo;
            i < sorted.length && sorted[i].projection <= projection + span;
            i++
          ) {
            tick();
            yield sorted[i].index;
          }
        })();
      }
      for (const i of candidates) {
        tick();
        const point = boundaryContacts[i].point;
        const distance = Math.hypot(
          ...point.map((v, axis) => Math.fround(v) - rounded[axis]),
        );
        if (distance < associationRadius) {
          if (candidate !== undefined) {
            ambiguous = true;
            break;
          }
          candidate = i;
        }
      }
      if (ambiguous) break;
    }
    if (lookupEntries < lookupLimit) {
      reserveLookup();
      lookupCache.set(cacheKey, ambiguous ? null : (candidate ?? null));
    }
    return ambiguous ? undefined : candidate;
  };
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
      if (binding === undefined && options.preciseCoordinates) {
        const candidate = uniqueNearby(hit.points[endpoint]);
        if (candidate !== undefined) {
          binding = candidate;
          segments[segment][endpoint] = [...boundaryContacts[candidate].point];
        }
      }
      if (binding !== undefined)
        endpointBindings.push({ segment, endpoint, contact: binding });
    }
    if (
      segments[segment][0].every(
        (value, axis) => value === segments[segment][1][axis],
      )
    ) {
      segments.pop();
      while (endpointBindings.at(-1)?.segment === segment)
        endpointBindings.pop();
    }
  }
  return { segments, boundaryContacts, endpointBindings };
}
