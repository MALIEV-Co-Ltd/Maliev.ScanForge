import {
  nativeReferenceCircumcenter,
  nativeReferenceNormalize,
} from "../reference-geometry-numerics.ts";
import type { ReferenceVector } from "../reference-construction-values";

type Points = readonly [ReferenceVector, ReferenceVector, ReferenceVector];
type Handle = { delete(): void; IsNull(): boolean };
// The bundled Embind constructors have no maintained TypeScript declaration.
type Kernel = Record<string, new (...args: any[]) => any>;

function point(value: unknown): ReferenceVector {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !Array.from(value).every((n) => typeof n === "number" && Number.isFinite(n))
  )
    throw new Error("Arc backend requires finite three-coordinate points.");
  return [value[0], value[1], value[2]];
}

function finite(value: number): number {
  if (!Number.isFinite(value))
    throw new Error("Arc backend arithmetic overflow.");
  return value;
}

/** Native admission runs after resetting the old backend. */
function admitted(points: Points): boolean {
  const [a, b, c] = points;
  const fit = nativeReferenceCircumcenter(a, b, c, true);
  if (!fit.nondegenerate) return false;
  const dy = c[1] - fit.center[1],
    dx = c[0] - fit.center[0],
    dz = c[2] - fit.center[2];
  const radius = Math.sqrt(finite(dy * dy + dx * dx + dz * dz));
  if (radius < 2 ** -23) return false;
  const delta = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  finite(delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2]);
  // Both observed calls normalize the SAME temporary. AC retains its length.
  // This scale-dependent check is not a conventional collinearity predicate.
  const direction = nativeReferenceNormalize(nativeReferenceNormalize(delta));
  const dot = finite(
    (c[0] - a[0]) * direction[0] +
      direction[1] * (c[1] - a[1]) +
      direction[2] * (c[2] - a[2]),
  );
  return 2 ** -23 <= Math.abs(1 - Math.abs(dot));
}

/**
 * Worker-local native-style arc backend. Owns one real CAD edge and three
 * backend records; the child's four source records live separately. Bundled
 * from this same source for the classic worker, with shared numeric helpers.
 * It does not register a scene shape, worker command or public GUI/MCP action.
 */
export class SketchArcBackend {
  #oc: Kernel;
  #edge: Handle | undefined;
  #points: Points | undefined;
  #disposed = false;

  constructor(oc: Kernel) {
    this.#oc = oc;
  }

  #requireLive() {
    if (this.#disposed) throw new Error("Sketch arc backend is disposed.");
  }

  #reset() {
    const old = this.#edge;
    this.#edge = undefined;
    this.#points = undefined;
    old?.delete();
  }

  /** Borrowed worker-local handle, invalidated by rebuild/dispose. */
  get edge() {
    this.#requireLive();
    return this.#edge;
  }

  snapshot() {
    return this.#edge
      ? {
          disposed: this.#disposed,
          kind: "arc" as const,
          records: this.#points!.map((p) => [...p]),
        }
      : { disposed: this.#disposed, kind: "empty" as const, records: [] };
  }

  rebuild(input: unknown): boolean {
    this.#requireLive();
    if (!input || typeof input !== "object")
      throw new Error("Invalid arc backend request.");
    const request = input as Record<string, unknown>;
    if (
      request.kind !== "arc" ||
      !Array.isArray(request.points) ||
      request.points.length !== 3
    )
      throw new Error("Arc backend requires three input points.");
    const points: Points = [
      point(request.points[0]),
      point(request.points[1]),
      point(request.points[2]),
    ];
    point(request.center); // Validated, then overwritten by the native center fit.
    // Malformed application requests preserve the old edge. Canonical finite
    // requests reset it before geometric admission, including equal endpoints.
    this.#reset();
    if (!admitted(points)) return false;
    const oc = this.#oc,
      handles: Handle[] = [];
    const keep = <T extends Handle>(value: T): T => (
      handles.push(value),
      value
    );
    let candidate: Handle | undefined;
    try {
      try {
        const a = keep(new oc.gp_Pnt_3(...points[0]));
        const b = keep(new oc.gp_Pnt_3(...points[1]));
        const c = keep(new oc.gp_Pnt_3(...points[2]));
        const maker = keep(new oc.GC_MakeArcOfCircle_4(a, b, c));
        if (!maker.IsDone()) return false;
        const trimmed = keep(maker.Value());
        if (trimmed.IsNull()) return false;
        const curve = keep(new oc.Handle_Geom_Curve_2(trimmed.get()));
        const edgeMaker = keep(new oc.BRepBuilderAPI_MakeEdge_24(curve));
        if (!edgeMaker.IsDone()) return false;
        candidate = edgeMaker.Edge();
      } finally {
        for (let i = handles.length - 1; i >= 0; i--) handles[i].delete();
      }
      if (!candidate || candidate.IsNull()) return false;
      this.#points = points;
      this.#edge = candidate;
      candidate = undefined;
      return true;
    } finally {
      candidate?.delete();
    }
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#reset();
  }
}
