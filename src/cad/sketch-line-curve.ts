import { SketchLineWireCandidate } from "./sketch-line-wire-candidate";
import { requireNativeSketchLineGeometrySettings } from "../sketch-line-geometry";
import type { ReferenceVector } from "../reference-construction-values";
import {
  evaluateNativeSketchLinePoint,
  prepareNativeSketchLineConversion,
  requireSketchLineCoordinateScale,
} from "../sketch-line-conversion";

type Handle = { delete(): void };
type Edge = Handle & { IsNull(): boolean };
type Kernel = Record<string, new (...args: any[]) => any>;
type Request = {
  kind: "line";
  points: readonly [ReferenceVector, ReferenceVector];
};

function point(value: unknown): ReferenceVector {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !Array.from(value).every((n) => typeof n === "number" && Number.isFinite(n))
  )
    throw new Error("Line curve requires finite XYZ points.");
  return [value[0], value[1], value[2]];
}
function finite(value: number): number {
  if (!Number.isFinite(value))
    throw new Error("Line curve arithmetic overflow.");
  return value;
}
function release(handles: Handle[]) {
  const errors: unknown[] = [];
  for (let i = handles.length - 1; i >= 0; i--) {
    try {
      handles[i].delete();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, "Line curve cleanup failed.");
}

export function requireSketchLineCurveRequest(input: unknown): Request {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid line curve request.");
  const r = input as Record<string, unknown>;
  if (
    r.kind !== "line" ||
    Object.keys(r).some((k) => k !== "kind" && k !== "points") ||
    !Array.isArray(r.points) ||
    r.points.length !== 2
  )
    throw new Error("Line curve requires exactly two points.");
  const request: Request = {
    kind: "line",
    points: [point(r.points[0]), point(r.points[1])],
  };
  return request;
}

/**
 * Owns the PRIMARY trimmed line edge only. A true rebuildCurve result does not
 * establish native line-backend success: converted body/first-edge admission
 * still belongs to the future composite backend. No body result is fabricated.
 */
export class SketchLineCurve {
  #oc: Kernel;
  #edge: Edge | undefined;
  #request: Request | undefined;
  #disposed = false;

  constructor(oc: Kernel) {
    this.#oc = oc;
  }
  #requireLive() {
    if (this.#disposed) throw new Error("Sketch line curve is disposed.");
  }
  #reset() {
    const edge = this.#edge;
    this.#edge = undefined;
    this.#request = undefined;
    edge?.delete();
  }
  /** Borrowed worker-local edge; invalidated by rebuild/dispose. */
  get edge() {
    this.#requireLive();
    return this.#edge;
  }
  snapshot() {
    return structuredClone({
      disposed: this.#disposed,
      hasCurve: this.#edge !== undefined,
      ...(this.#request ? { request: this.#request } : {}),
    });
  }
  rebuildCurve(input: unknown): boolean {
    this.#requireLive();
    const request = requireSketchLineCurveRequest(input);
    // Canonical malformed inputs preserve old geometry; finite geometry resets
    // it before the native line admission threshold is evaluated.
    this.#reset();
    const [a, b] = request.points;
    const dx = a[0] - b[0],
      dy = a[1] - b[1],
      dz = a[2] - b[2];
    if (Math.sqrt(finite(dx * dx + dy * dy + dz * dz)) < 1e-7) return false;
    const x = b[0] - a[0],
      y = b[1] - a[1],
      z = b[2] - a[2];
    const length = Math.sqrt(finite(x * x + y * y + z * z));
    const oc = this.#oc,
      handles: Handle[] = [];
    const keep = <T extends Handle>(h: T): T => (handles.push(h), h);
    let candidate: Edge | undefined;
    try {
      try {
        const origin = keep(new oc.gp_Pnt_3(...a));
        const direction = keep(new oc.gp_Dir_4(x, y, z));
        const line = keep(new oc.gp_Lin_3(origin, direction));
        // This pinned OCCT overload creates Geom_Line + Geom_TrimmedCurve with
        // the supplied parameter bounds. The maker owns the transient objects.
        const segment = keep(new oc.GC_MakeSegment_2(line, 0, length));
        if (!segment.IsDone()) return false;
        const trimmed = keep(segment.Value());
        if (trimmed.IsNull()) return false;
        const curve = keep(new oc.Handle_Geom_Curve_2(trimmed.get()));
        const edgeMaker = keep(new oc.BRepBuilderAPI_MakeEdge_24(curve));
        if (!edgeMaker.IsDone()) return false;
        candidate = edgeMaker.Edge();
      } finally {
        release(handles);
      }
      if (!candidate || candidate.IsNull()) return false;
      this.#edge = candidate;
      this.#request = request;
      candidate = undefined;
      return true;
    } finally {
      candidate?.delete();
    }
  }
  /** Geometry query only. Native midpoint publication must also check its body. */
  evaluateFraction(fraction: number): ReferenceVector | undefined {
    this.#requireLive();
    if (typeof fraction !== "number" || !Number.isFinite(fraction))
      throw new Error("Line curve fraction must be finite.");
    if (!this.#edge) return undefined;
    const bounded = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
    const handles: Handle[] = [];
    try {
      const adaptor = new this.#oc.BRepAdaptor_Curve_2(this.#edge);
      handles.push(adaptor);
      const first = adaptor.FirstParameter(),
        last = adaptor.LastParameter();
      const p = adaptor.Value(finite((last - first) * bounded + first));
      handles.push(p);
      return point([p.X(), p.Y(), p.Z()]);
    } finally {
      release(handles);
    }
  }
  /** Conversion parameters only; no provider allocation or body success. */
  prepareBodyConversion(coordinateScale: unknown) {
    this.#requireLive();
    const scale = requireSketchLineCoordinateScale(coordinateScale);
    if (!this.#edge) return undefined;
    // Use the actual edge evaluations, which can differ from input coordinates
    // after analytic construction. Each query retires its temporary handles.
    return prepareNativeSketchLineConversion(
      this.evaluateFraction(0),
      this.evaluateFraction(1),
      scale,
    );
  }
  /** Provider-coordinate endpoint preparation only; no wire/body acceptance. */
  prepareBodyEndpoints(coordinateScale: unknown) {
    const conversion = this.prepareBodyConversion(coordinateScale);
    if (!conversion) return undefined;
    return {
      conversion,
      start: evaluateNativeSketchLinePoint(
        conversion.origin,
        conversion.direction,
        conversion.interval[0],
      ),
      end: evaluateNativeSketchLinePoint(
        conversion.origin,
        conversion.direction,
        conversion.interval[1],
      ),
    };
  }
  /** The returned candidate belongs to the caller; no native admission is inferred. */
  prepareBodyCandidate(coordinateScale: unknown, settings: unknown) {
    this.#requireLive();
    const resolved = requireNativeSketchLineGeometrySettings(settings);
    const prepared = this.prepareBodyEndpoints(coordinateScale);
    return prepared
      ? SketchLineWireCandidate.createChecked(this.#oc, prepared, resolved)
      : undefined;
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#reset();
  }
}
