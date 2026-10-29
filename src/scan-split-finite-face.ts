import type { Vec3 } from "./types";
import type { ExperimentalPointOrder } from "./scan-split-native-point-order";
import {
  exactSegmentTriangleCrossing,
  exactEdgeWitnessCrossing,
  type ExactEdgeWitness,
} from "./scan-split-exact-crossing";

type P2 = [number, number];
type Tri = [number, number, number];
type Seg = [number, number];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const EPS = Number.EPSILON * 32;
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const cross = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0];
const crossSign = (a: P2, b: P2) => {
  const value = cross(a, b);
  const bound =
    Number.EPSILON * 16 * (Math.abs(a[0] * b[1]) + Math.abs(a[1] * b[0]));
  return value > bound ? 1 : value < -bound ? -1 : 0;
};
const orientSign = (a: P2, b: P2, c: P2) => crossSign(sub(b, a), sub(c, a));
const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const distance = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const parameter = (p: P2, a: P2, b: P2) => {
  const d = sub(b, a),
    q = sub(p, a);
  return (q[0] * d[0] + q[1] * d[1]) / (d[0] * d[0] + d[1] * d[1]);
};
const onSegment = (p: P2, a: P2, b: P2) =>
  orientSign(a, b, p) === 0 &&
  parameter(p, a, b) >= 0 &&
  parameter(p, a, b) <= 1;

// Isolated experiment only: exact binary64 incircle sign.
const experimentalIncircle = (a: P2, b: P2, c: P2, d: P2): number => {
  const values = [...a, ...b, ...c, ...d];
  const view = new DataView(new ArrayBuffer(8));
  const parts = values.map((value): [bigint, number] => {
    view.setFloat64(0, value, false);
    const high = view.getUint32(0, false),
      low = view.getUint32(4, false);
    const exponent = (high >>> 20) & 0x7ff;
    let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
    if (exponent) mantissa |= 1n << 52n;
    if (high >>> 31) mantissa = -mantissa;
    return [mantissa, exponent ? exponent - 1075 : -1074];
  });
  const minimum = Math.min(
    0,
    ...parts.filter(([m]) => m !== 0n).map(([, e]) => e),
  );
  const v = parts.map(([m, e]) => m << BigInt(e - minimum));
  const x = [v[0] - v[6], v[2] - v[6], v[4] - v[6]],
    y = [v[1] - v[7], v[3] - v[7], v[5] - v[7]];
  const z = x.map((n, i) => n * n + y[i] * y[i]);
  const determinant =
    x[0] * (y[1] * z[2] - y[2] * z[1]) +
    x[1] * (y[2] * z[0] - y[0] * z[2]) +
    x[2] * (y[0] * z[1] - y[1] * z[0]);
  return determinant > 0n ? 1 : determinant < 0n ? -1 : 0;
};

/** Local constrained triangulation. Shared-edge propagation and output grouping are separate. */
export function triangulateFiniteFace(
  face: readonly [Vec3, Vec3, Vec3],
  segments: readonly [Vec3, Vec3][],
  options: {
    signal?: AbortSignal;
    maxWork?: number;
    check?: () => void;
    preciseCoordinates?: boolean;
    experimentalPointOrder?: ExperimentalPointOrder;
    boundaryContacts?: readonly {
      edge: 0 | 1 | 2;
      t: number;
      point: Vec3;
      canonical?: {
        t: number;
        reversed: boolean;
        fromEnd?: number;
        exactCutter?: [Vec3, Vec3, Vec3];
        exactWitness?: ExactEdgeWitness;
      };
    }[];
    endpointBindings?: readonly {
      segment: number;
      endpoint: 0 | 1;
      contact: number;
    }[];
  } = {},
  rotatedForPrecision = false,
  sharedBudget?: { work: number; limit: number },
): {
  vertices: Vec3[];
  triangles: Tri[];
  constraints: Seg[];
  boundaryVertices: number[];
} {
  const outputCoordinate = options.preciseCoordinates
    ? (n: number) => n
    : Math.fround;
  const maxWork = options.maxWork ?? 2_000_000;
  if (!Number.isSafeInteger(maxWork) || maxWork < 1)
    throw new Error("Finite face work budget is invalid.");
  const budget = sharedBudget ?? { work: 0, limit: maxWork };
  const tick = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    options.check?.();
    if (++budget.work > budget.limit)
      throw new Error("Finite face work budget exceeded.");
  };
  tick();
  const rotation = (options.boundaryContacts ?? [])
    .map((c) => {
      tick();
      if (
        c.t === 1 &&
        c.edge !== 2 &&
        c.canonical &&
        ((c.canonical.reversed && c.canonical.t > 0 && c.canonical.t < 1) ||
          (!c.canonical.reversed && c.canonical.fromEnd !== undefined))
      )
        return (c.edge + 1) % 3;
      if (c.t > 0 && c.t < 1 && 1 - c.t === 1 && c.edge !== 0) return c.edge;
      return 0;
    })
    .find((shift) => shift !== 0);
  if (rotation !== undefined) {
    if (rotatedForPrecision) {
      const boundaries = options.boundaryContacts ?? [],
        bindings = options.endpointBindings ?? [];
      if (
        segments.length === 1 &&
        boundaries.length === 2 &&
        boundaries[0].edge !== boundaries[1].edge &&
        bindings.length === 2 &&
        bindings.every(
          (b) =>
            b.segment === 0 &&
            (b.endpoint === 0 || b.endpoint === 1) &&
            (b.contact === 0 || b.contact === 1),
        ) &&
        new Set(bindings.map((b) => b.endpoint)).size === 2 &&
        new Set(bindings.map((b) => b.contact)).size === 2
      ) {
        for (const b of bindings) {
          tick();
          const p = segments[0][b.endpoint],
            q = boundaries[b.contact].point;
          if (
            p.length !== 3 ||
            q.length !== 3 ||
            !p.every((v, i) => outputCoordinate(v) === outputCoordinate(q[i]))
          )
            throw new Error("Finite endpoint binding is invalid.");
        }
        for (const boundary of boundaries) {
          tick();
          const checked = triangulateFiniteFace(
            face,
            [],
            {
              signal: options.signal,
              maxWork: options.maxWork,
              check: options.check,
              preciseCoordinates: options.preciseCoordinates,
              boundaryContacts: [boundary],
            },
            false,
            budget,
          );
          if (
            !checked.vertices[checked.boundaryVertices[0]].every(
              (v, i) =>
                outputCoordinate(v) === outputCoordinate(boundary.point[i]),
            )
          )
            throw new Error("Finite boundary contact validation failed.");
        }
        const vertices: Vec3[] = [
          ...face.map((p) => [...p] as Vec3),
          ...boundaries.map((b) => b.point.map(outputCoordinate) as Vec3),
        ];
        const ring: number[] = [];
        for (let edge = 0; edge < 3; edge++) {
          tick();
          ring.push(edge);
          const contact = boundaries.findIndex((b) => b.edge === edge);
          if (contact >= 0) ring.push(3 + contact);
        }
        const path = (start: number, end: number) => {
          const result = [start];
          let at = ring.indexOf(start);
          while (ring[at] !== end) {
            tick();
            at = (at + 1) % ring.length;
            result.push(ring[at]);
          }
          return result;
        };
        const normal = cross3(sub3(face[1], face[0]), sub3(face[2], face[0]));
        const triangles: Tri[] = [];
        for (const polygon of [path(3, 4), path(4, 3)]) {
          tick();
          let chosen: Tri[] | undefined;
          for (let pivot = 0; pivot < polygon.length && !chosen; pivot++) {
            tick();
            const fan: Tri[] = [];
            for (let i = 1; i + 1 < polygon.length; i++) {
              tick();
              fan.push([
                polygon[pivot],
                polygon[(pivot + i) % polygon.length],
                polygon[(pivot + i + 1) % polygon.length],
              ]);
            }
            if (
              fan.every(([i, j, k]) => {
                tick();
                return (
                  dot3(
                    cross3(
                      sub3(
                        vertices[j].map(outputCoordinate) as Vec3,
                        vertices[i].map(outputCoordinate) as Vec3,
                      ),
                      sub3(
                        vertices[k].map(outputCoordinate) as Vec3,
                        vertices[i].map(outputCoordinate) as Vec3,
                      ),
                    ),
                    normal,
                  ) > 0
                );
              })
            )
              chosen = fan;
          }
          if (!chosen)
            throw new Error(
              "Finite boundary cut loses a facet at Float32 precision.",
            );
          triangles.push(...chosen);
        }
        return {
          vertices,
          triangles,
          constraints: [[3, 4]],
          boundaryVertices: [3, 4],
        };
      }
      throw new Error(
        "Finite face has incompatible boundary precision requirements.",
      );
    }
    const shift = rotation;
    const rotated: [Vec3, Vec3, Vec3] = [
      face[shift],
      face[(shift + 1) % 3],
      face[(shift + 2) % 3],
    ];
    const result = triangulateFiniteFace(
      rotated,
      segments,
      {
        ...options,
        boundaryContacts: options.boundaryContacts?.map((contact) => ({
          ...contact,
          edge: ((contact.edge - shift + 3) % 3) as 0 | 1 | 2,
        })),
      },
      true,
      budget,
    );
    const index = (n: number) => (n < 3 ? (n + shift) % 3 : n);
    return {
      vertices: [
        [...face[0]],
        [...face[1]],
        [...face[2]],
        ...result.vertices.slice(3),
      ],
      triangles: result.triangles.map((t) => t.map(index) as Tri),
      constraints: result.constraints.map((e) => e.map(index) as Seg),
      boundaryVertices: result.boundaryVertices.map(index),
    };
  }
  if (segments.length > 128)
    throw new Error("Finite face constraint budget exceeded.");
  if (
    !face.every((point) => point.every(Number.isFinite)) ||
    !segments.every((segment) =>
      segment.every((point) => point.every(Number.isFinite)),
    )
  )
    throw new Error("Finite face coordinates must be finite.");
  const a = face[0],
    u = face[1].map((v, i) => v - a[i]),
    v = face[2].map((x, i) => x - a[i]);
  const dot = (x: readonly number[], y: readonly number[]) =>
    x.reduce((sum, n, i) => sum + n * y[i], 0);
  const uu = dot(u, u),
    uv = dot(u, v),
    vv = dot(v, v),
    det = uu * vv - uv * uv;
  if (!(det > 0)) throw new Error("Finite face is degenerate.");
  const project = (p: Vec3): P2 => {
    const q = p.map((x, i) => x - a[i]),
      qu = dot(q, u),
      qv = dot(q, v);
    const x = (qu * vv - qv * uv) / det,
      y = (qv * uu - qu * uv) / det;
    const residual = q.map((n, i) => n - x * u[i] - y * v[i]);
    if (
      Math.hypot(...residual) > Math.sqrt(Math.max(uu, vv)) * 1e-10 ||
      x < -EPS ||
      y < -EPS ||
      x + y > 1 + EPS
    )
      throw new Error("Finite constraint lies outside its source face.");
    if (
      p.some((value, axis) => {
        const reconstructed = a[axis] + x * u[axis] + y * v[axis];
        if (!options.preciseCoordinates)
          return outputCoordinate(value) !== outputCoordinate(reconstructed);
        const error =
          Number.EPSILON *
          64 *
          (Math.abs(a[axis]) +
            Math.abs(x * u[axis]) +
            Math.abs(y * v[axis]) +
            Math.abs(value) +
            1);
        return Math.abs(value - reconstructed) > error;
      })
    )
      throw new Error("Finite constraint would move at output precision.");
    return [x, y];
  };
  const compare = (p: P2, q: P2) => p[0] - q[0] || p[1] - q[1];
  const boundaryOutput = new Map<P2, Vec3>();
  const boundary = (options.boundaryContacts ?? []).map(
    ({ edge, t, point, canonical }): P2 => {
      tick();
      if (
        ![0, 1, 2].includes(edge) ||
        !Number.isFinite(t) ||
        t <= 0 ||
        (t >= 1 &&
          !(
            t === 1 &&
            canonical &&
            ((canonical.reversed && canonical.t > 0 && canonical.t < 1) ||
              (!canonical.reversed && canonical.fromEnd !== undefined)) &&
            edge === 2
          )) ||
        point.length !== 3 ||
        !point.every(Number.isFinite)
      )
        throw new Error("Finite boundary contact is invalid.");
      const complement = canonical?.reversed
        ? canonical.t
        : (canonical?.fromEnd ?? 1 - t);
      const p: P2 =
        edge === 0 ? [t, 0] : edge === 1 ? [complement, t] : [0, complement];
      if (
        canonical &&
        (!Number.isFinite(canonical.t) ||
          canonical.t <= 0 ||
          (canonical.t >= 1 &&
            !(canonical.t === 1 && canonical.fromEnd !== undefined)) ||
          (canonical.fromEnd !== undefined &&
            (!Number.isFinite(canonical.fromEnd) ||
              canonical.fromEnd <= 0 ||
              canonical.fromEnd >= 1 ||
              canonical.t !== 1 ||
              1 - canonical.fromEnd !== 1)) ||
          typeof canonical.reversed !== "boolean" ||
          t !==
            (canonical.reversed
              ? (canonical.fromEnd ?? 1 - canonical.t)
              : canonical.t))
      )
        throw new Error("Finite boundary canonical parameter is invalid.");
      const start = face[edge],
        end = face[(edge + 1) % 3];
      const exact =
        options.preciseCoordinates && canonical?.exactCutter
          ? exactSegmentTriangleCrossing(start, end, canonical.exactCutter, {
              exactPoint: true,
            })
          : undefined;
      if (
        canonical?.exactCutter &&
        options.preciseCoordinates &&
        (!exact?.inside || !exact.roundedPoint)
      )
        throw new Error("Finite exact boundary contact is invalid.");
      const witnessed =
        options.preciseCoordinates && canonical?.exactWitness
          ? exactEdgeWitnessCrossing(start, end, canonical.exactWitness)
          : undefined;
      if (
        exact?.exactPoint &&
        witnessed &&
        !exact.exactPoint.every((n, i) => n === witnessed.exactPoint[i])
      )
        throw new Error("Finite exact boundary witnesses disagree.");
      const expected =
        witnessed?.roundedPoint ??
        exact?.roundedPoint ??
        (canonical
          ? canonical.fromEnd !== undefined
            ? (canonical.reversed ? start : end).map((n, i) =>
                outputCoordinate(
                  n +
                    canonical.fromEnd! *
                      ((canonical.reversed ? end : start)[i] - n),
                ),
              )
            : (canonical.reversed ? end : start).map((n, i) =>
                outputCoordinate(
                  n + canonical.t * ((canonical.reversed ? start : end)[i] - n),
                ),
              )
          : a.map((n, i) => outputCoordinate(n + p[0] * u[i] + p[1] * v[i])));
      if (point.some((n, i) => outputCoordinate(n) !== expected[i]))
        throw new Error(
          "Finite boundary contact does not match its source edge.",
        );
      boundaryOutput.set(p, point.map(outputCoordinate) as Vec3);
      return p;
    },
  );
  const bindings = new Map<string, number>();
  for (const binding of options.endpointBindings ?? []) {
    tick();
    const { segment, endpoint, contact } = binding;
    const id = `${segment}:${endpoint}`;
    if (
      !Number.isSafeInteger(segment) ||
      segment < 0 ||
      segment >= segments.length ||
      (endpoint !== 0 && endpoint !== 1) ||
      !Number.isSafeInteger(contact) ||
      contact < 0 ||
      contact >= boundary.length ||
      bindings.has(id) ||
      segments[segment][endpoint].some(
        (n, i) =>
          outputCoordinate(n) !==
          outputCoordinate(options.boundaryContacts![contact].point[i]),
      )
    )
      throw new Error("Finite endpoint binding is invalid.");
    bindings.set(id, contact);
  }
  // Preserve the precise path when distinct intersections share a Float32 key.
  const pointOrder =
    options.experimentalPointOrder &&
    !segments.some((segment) =>
      segment.some((point) => {
        tick();
        return options.experimentalPointOrder!.ambiguous.has(
          JSON.stringify(point.map(Math.fround)),
        );
      }),
    )
      ? options.experimentalPointOrder.ranks
      : undefined;
  const raw = segments.map(([p, q], index) => {
    const firstBinding = bindings.get(`${index}:0`),
      secondBinding = bindings.get(`${index}:1`);
    const first =
        firstBinding === undefined ? project(p) : boundary[firstBinding],
      second =
        secondBinding === undefined ? project(q) : boundary[secondBinding];
    return (
      compare(first, second) <= 0 ? [first, second] : [second, first]
    ) as [P2, P2];
  });
  if (!pointOrder)
    raw.sort(
      (left, right) => compare(left[0], right[0]) || compare(left[1], right[1]),
    );
  for (const s of raw)
    if (distance(s[0], s[1]) <= EPS)
      throw new Error("Finite constraint is degenerate.");
  const candidates: P2[] = raw.flatMap(([p, q]) => [p, q]);
  const breaks = raw.map(([p, q]) => [p, q]);
  for (const p of boundary) {
    tick();
    candidates.push(p);
    for (let i = 0; i < raw.length; i++) {
      tick();
      if (onSegment(p, raw[i][0], raw[i][1])) breaks[i].push(p);
    }
  }
  for (let i = 0; i < raw.length; i++)
    for (let j = i + 1; j < raw.length; j++) {
      tick();
      const [p, p2] = raw[i],
        [q, q2] = raw[j],
        r = sub(p2, p),
        t = sub(q2, q),
        den = cross(r, t),
        delta = sub(q, p);
      if (crossSign(r, t) === 0) {
        for (const point of [q, q2])
          if (onSegment(point, p, p2)) breaks[i].push(point);
        for (const point of [p, p2])
          if (onSegment(point, q, q2)) breaks[j].push(point);
        continue;
      }
      const x = cross(delta, t) / den,
        y = cross(delta, r) / den;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        const point: P2 = [p[0] + x * r[0], p[1] + x * r[1]];
        candidates.push(point);
        breaks[i].push(point);
        breaks[j].push(point);
      }
    }
  if (!pointOrder) candidates.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const points: P2[] = [
    [0, 0],
    [1, 0],
    [0, 1],
  ];
  const roundedPoint = (p: P2) =>
    boundaryOutput.get(p) ??
    a.map((n, i) => outputCoordinate(n + p[0] * u[i] + p[1] * v[i]));
  for (const p of candidates) {
    let found = false;
    const output = roundedPoint(p);
    for (const q of points) {
      tick();
      const bound =
        Number.EPSILON *
        8 *
        Math.max(...p.map(Math.abs), ...q.map(Math.abs), Number.MIN_VALUE);
      const near = distance(p, q) <= bound;
      const rounded = roundedPoint(q);
      const same = output.every((value, axis) => value === rounded[axis]);
      if (near && same) {
        found = true;
        break;
      }
      if (near || same)
        throw new Error(
          "Finite constraints cannot be distinguished safely at output precision.",
        );
    }
    if (!found) points.push(p);
  }
  // Experimental global first-seen hit ordering, without captured oracle data.
  if (pointOrder) {
    const order = (p: P2) => {
      const xyz = a.map((n, i) => Math.fround(n + p[0] * u[i] + p[1] * v[i]));
      return pointOrder.get(JSON.stringify(xyz)) ?? Number.MAX_SAFE_INTEGER;
    };
    const extra = points.slice(3).sort((p, q) => {
      tick();
      return order(p) - order(q);
    });
    points.splice(3, points.length - 3, ...extra);
  }
  const edgeContacts = new Map<
    number,
    { edge: number; t: number; remaining: number }
  >();
  for (const contact of options.boundaryContacts ?? []) {
    tick();
    const expected = contact.point.map(outputCoordinate);
    const id = points.findIndex((p) => {
      tick();
      return roundedPoint(p).every((n, i) => n === expected[i]);
    });
    if (id < 3)
      throw new Error(
        "Finite boundary contact vertex is missing or collapsed.",
      );
    const remaining = contact.canonical?.reversed
      ? contact.canonical.t
      : (contact.canonical?.fromEnd ?? 1 - contact.t);
    const prior = edgeContacts.get(id);
    if (
      prior &&
      (prior.edge !== contact.edge ||
        prior.t !== contact.t ||
        prior.remaining !== remaining)
    )
      throw new Error("Finite boundary contact identity is ambiguous.");
    edgeContacts.set(id, { edge: contact.edge, t: contact.t, remaining });
  }
  const onKnownBoundary = (id: number, x: number, y: number): boolean => {
    const contact = edgeContacts.get(id);
    if (!contact) return false;
    const position = (
      vertex: number,
    ): { t: number; remaining: number } | undefined => {
      if (vertex === contact.edge) return { t: 0, remaining: 1 };
      if (vertex === (contact.edge + 1) % 3) return { t: 1, remaining: 0 };
      const other = edgeContacts.get(vertex);
      if (other?.edge === contact.edge) return other;
      const start = points[contact.edge],
        end = points[(contact.edge + 1) % 3],
        point = points[vertex];
      if (
        cross(sub(end, start), sub(point, start)) === 0 &&
        onSegment(point, start, end)
      ) {
        const t = parameter(point, start, end);
        return { t, remaining: 1 - t };
      }
      return undefined;
    };
    const a = position(x),
      b = position(y);
    if (!a || !b) return false;
    const compare = (
      a: { t: number; remaining: number },
      b: { t: number; remaining: number },
    ) => a.t - b.t || b.remaining - a.remaining;
    return (
      (compare(a, contact) < 0 && compare(contact, b) < 0) ||
      (compare(b, contact) < 0 && compare(contact, a) < 0)
    );
  };
  const nativeMetric = (() => {
    if (!pointOrder) return undefined;
    const f = Math.fround;
    const nativeA = face[0].map(f),
      nativeB = face[1].map(f),
      nativeC = face[2].map(f);
    const nativeU = nativeB.map((v, i) => f(v - nativeA[i])) as Vec3;
    const nativeV = nativeC.map((v, i) => f(v - nativeA[i])) as Vec3;
    const unit = (v: Vec3): Vec3 => {
      const length = Math.hypot(...v);
      return v.map((x) => (length > 0 ? x / length : NaN)) as Vec3;
    };
    const normal = unit(cross3(nativeU, nativeV));
    const secondary = unit(cross3(normal, nativeU));
    const xAxis = unit(cross3(secondary, normal));
    const yAxis = unit(cross3(normal, xAxis));
    const xOffset = -dot(nativeA, xAxis),
      yOffset = -dot(nativeA, yAxis);
    const value = (p: readonly number[], axis: Vec3, offset: number) =>
      f(p[1] * axis[1] + p[0] * axis[0] + p[2] * axis[2] + offset);
    const dx = value(nativeB, xAxis, xOffset),
      dy = value(nativeC, yAxis, yOffset);
    const metric = (point: P2): P2 => {
      const xyz = a.map((n, i) => f(n + point[0] * u[i] + point[1] * v[i]));
      return [value(xyz, xAxis, xOffset) / dx, value(xyz, yAxis, yOffset) / dy];
    };
    const seen = new Set<string>();
    for (const point of points) {
      tick();
      const projected = metric(point);
      if (!projected.every(Number.isFinite)) return undefined;
      const key = JSON.stringify(projected);
      if (seen.has(key)) return undefined;
      seen.add(key);
    }
    return metric;
  })();
  let tris: Tri[] = [[0, 1, 2]];
  const make = (i: number, j: number, k: number): Tri => {
    const d = orientSign(points[i], points[j], points[k]);
    if (!d) throw new Error("Finite triangulation became degenerate.");
    return d > 0 ? [i, j, k] : [i, k, j];
  };
  for (let id = 3; id < points.length; id++) {
    const p = points[id];
    let boundary: Seg | undefined;
    for (const t of tris)
      for (let k = 0; k < 3; k++) {
        tick();
        const x = t[k],
          y = t[(k + 1) % 3];
        if (
          edgeContacts.has(id)
            ? onKnownBoundary(id, x, y)
            : onSegment(p, points[x], points[y])
        ) {
          boundary = [x, y];
          break;
        }
      }
    if (edgeContacts.has(id) && !boundary)
      throw new Error(
        "Finite boundary contact could not be placed on its source edge.",
      );
    if (
      boundary &&
      (!nativeMetric ||
        orientSign(points[boundary[0]], points[boundary[1]], p) !== 0)
    ) {
      const [x, y] = boundary,
        next: Tri[] = [];
      for (const t of tris) {
        tick();
        if (t.includes(x) && t.includes(y)) {
          const z = t.find((n) => n !== x && n !== y)!;
          next.push(make(x, id, z), make(id, y, z));
        } else next.push(t);
      }
      tris = next;
    } else {
      const index = tris.findIndex(([x, y, z]) => {
        tick();
        return (
          orientSign(points[x], points[y], p) >= 0 &&
          orientSign(points[y], points[z], p) >= 0 &&
          orientSign(points[z], points[x], p) >= 0
        );
      });
      if (index < 0)
        throw new Error("Finite constraint point could not be located.");
      if (!nativeMetric) {
        const [x, y, z] = tris[index];
        tris.splice(index, 1, make(x, y, id), make(y, z, id), make(z, x, id));
        continue;
      }
      const edges = new Map<string, { a: number; b: number; count: number }>();
      const keep: Tri[] = [];
      for (const triangle of tris) {
        tick();
        const [x, y, z] = triangle;
        if (
          experimentalIncircle(
            nativeMetric(points[x]),
            nativeMetric(points[y]),
            nativeMetric(points[z]),
            nativeMetric(p),
          ) < 0
        ) {
          keep.push(triangle);
          continue;
        }
        for (const [a, b] of [
          [x, y],
          [y, z],
          [z, x],
        ]) {
          tick();
          const k = key(a, b),
            prior = edges.get(k);
          if (prior) prior.count++;
          else edges.set(k, { a, b, count: 1 });
        }
      }
      if (!edges.size) throw new Error("Finite cavity is empty.");
      let collinearCavityBoundary = false;
      if (boundary && !edgeContacts.has(id)) {
        for (const edge of edges.values()) {
          tick();
          if (
            edge.count === 1 &&
            !orientSign(points[edge.a], points[edge.b], p)
          ) {
            collinearCavityBoundary = true;
            break;
          }
        }
      }
      if (boundary && collinearCavityBoundary) {
        const [x, y] = boundary,
          next: Tri[] = [];
        for (const triangle of tris) {
          tick();
          if (triangle.includes(x) && triangle.includes(y)) {
            const z = triangle.find((n) => n !== x && n !== y)!;
            next.push(make(x, id, z), make(id, y, z));
          } else next.push(triangle);
        }
        tris = next;
        continue;
      }
      for (const edge of edges.values()) {
        tick();
        if (edge.count === 1 && orientSign(points[edge.a], points[edge.b], p))
          keep.push(make(edge.a, edge.b, id));
      }
      tris = keep;
    }
  }
  const constraints: Seg[] = [];
  const requested = new Set<string>();
  for (let segment = 0; segment < raw.length; segment++) {
    const [p, q] = raw[segment];
    const ids = breaks[segment]
      .map((point) => {
        const output = roundedPoint(point);
        const id = points.findIndex((candidate) => {
          tick();
          const rounded = roundedPoint(candidate);
          return output.every((value, axis) => value === rounded[axis]);
        });
        if (id < 0)
          throw new Error("Finite constraint point could not be identified.");
        return { id, t: parameter(point, p, q) };
      })
      .sort((x, y) => x.t - y.t);
    for (let i = 0; i + 1 < ids.length; i++) {
      const x = ids[i].id,
        y = ids[i + 1].id,
        k = key(x, y);
      if (x !== y && !requested.has(k)) {
        requested.add(k);
        constraints.push(x < y ? [x, y] : [y, x]);
      }
    }
  }
  constraints.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const locked = new Set<string>();
  const signature = (state: Tri[]) =>
    state
      .map((triangle) => {
        tick();
        return [...triangle].sort((a, b) => a - b).join(":");
      })
      .sort()
      .join("|");
  for (const [p, q] of constraints) {
    const wanted = key(p, q);
    const stack: Tri[][] = [tris];
    const visited = new Set([signature(tris)]);
    let recovered: Tri[] | undefined;
    while (stack.length) {
      tick();
      const state = stack.pop()!;
      const edges = new Map<
        string,
        { a: number; b: number; faces: number[] }
      >();
      for (let i = 0; i < state.length; i++)
        for (let j = 0; j < 3; j++) {
          tick();
          const a = state[i][j],
            b = state[i][(j + 1) % 3],
            k = key(a, b);
          const item = edges.get(k) ?? { a, b, faces: [] };
          item.faces.push(i);
          edges.set(k, item);
        }
      if (edges.has(wanted)) {
        recovered = state;
        break;
      }
      const next: { state: Tri[]; crossing: boolean }[] = [];
      for (const [k, e] of edges) {
        tick();
        if (e.faces.length !== 2 || locked.has(k)) continue;
        const pa = orientSign(points[p], points[q], points[e.a]),
          pb = orientSign(points[p], points[q], points[e.b]);
        const ap = orientSign(points[e.a], points[e.b], points[p]),
          aq = orientSign(points[e.a], points[e.b], points[q]);
        if (!(pa * pb < 0 && ap * aq < 0)) continue;
        const [i, j] = e.faces,
          c = state[i].find((n) => n !== e.a && n !== e.b)!,
          d = state[j].find((n) => n !== e.a && n !== e.b)!;
        if (
          edges.has(key(c, d)) ||
          orientSign(points[d], points[c], points[e.b]) === 0 ||
          orientSign(points[c], points[d], points[e.a]) *
            orientSign(points[c], points[d], points[e.b]) >=
            0
        )
          continue;
        const candidate = state.slice();
        candidate[i] = make(c, d, e.a);
        candidate[j] = make(d, c, e.b);
        const id = signature(candidate);
        if (visited.has(id)) continue;
        visited.add(id);
        const crossing =
          orientSign(points[p], points[q], points[c]) *
            orientSign(points[p], points[q], points[d]) <
            0 &&
          orientSign(points[c], points[d], points[p]) *
            orientSign(points[c], points[d], points[q]) <
            0;
        next.push({ state: candidate, crossing });
      }
      // LIFO: explore non-crossing replacement diagonals first, but retain alternatives.
      next.sort((a, b) => Number(b.crossing) - Number(a.crossing));
      for (const item of next) stack.push(item.state);
    }
    if (!recovered)
      throw new Error("Finite constraint could not be recovered.");
    tris = recovered;
    locked.add(wanted);
  }
  if (pointOrder) {
    const directed = new Set<string>();
    let invalid = false;
    for (const tri of tris)
      for (let i = 0; i < 3; i++) {
        tick();
        const edge = `${tri[i]}:${tri[(i + 1) % 3]}`;
        if (directed.has(edge)) invalid = true;
        directed.add(edge);
      }
    if (invalid)
      return triangulateFiniteFace(
        face,
        segments,
        { ...options, experimentalPointOrder: undefined },
        rotatedForPrecision,
        budget,
      );
  }
  const vertices = points.map(
    (p) =>
      boundaryOutput.get(p) ??
      (a.map((n, i) => n + p[0] * u[i] + p[1] * v[i]) as Vec3),
  );
  const outputIds = new Map<string, number>();
  for (let i = 0; i < vertices.length; i++) {
    tick();
    const rounded = vertices[i].map(outputCoordinate);
    if (!rounded.every(Number.isFinite))
      throw new Error("Finite face output coordinates are invalid.");
    const id = JSON.stringify(rounded);
    if (outputIds.has(id))
      throw new Error("Finite face output vertex identity is ambiguous.");
    outputIds.set(id, i);
  }
  const boundaryVertices = (options.boundaryContacts ?? []).map(({ point }) => {
    tick();
    const id = outputIds.get(JSON.stringify(point.map(outputCoordinate)));
    if (id === undefined)
      throw new Error("Finite boundary contact vertex is missing.");
    return id;
  });
  const normal = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  for (const [i, j, k] of tris) {
    tick();
    const p = vertices[i].map(outputCoordinate),
      q = vertices[j].map(outputCoordinate),
      r = vertices[k].map(outputCoordinate);
    const x = q.map((value, axis) => value - p[axis]),
      y = r.map((value, axis) => value - p[axis]);
    const roundedNormal = [
      x[1] * y[2] - x[2] * y[1],
      x[2] * y[0] - x[0] * y[2],
      x[0] * y[1] - x[1] * y[0],
    ];
    if (!(dot(normal, roundedNormal) > 0))
      throw new Error(
        `Finite triangulation loses or reverses a facet at Float32 precision (vertices ${i}, ${j}, ${k}; rounded ${JSON.stringify([p, q, r])}).`,
      );
  }
  return { vertices, triangles: tris, constraints, boundaryVertices };
}
