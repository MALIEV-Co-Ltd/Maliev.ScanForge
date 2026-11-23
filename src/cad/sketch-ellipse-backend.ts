import type { SketchEllipseBackendRequest } from "../sketch-ellipse-rebuild.ts";
import type { ReferenceVector } from "../reference-construction-values";
type Handle = { delete(): void; IsNull(): boolean };
type Kernel = Record<string, new (...args: any[]) => any>;
function point(value: unknown): ReferenceVector {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !Array.from(value).every((n) => typeof n === "number" && Number.isFinite(n))
  )
    throw new Error("Ellipse backend requires finite XYZ values.");
  return [value[0], value[1], value[2]];
}
function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Ellipse backend requires finite numbers.");
  return value;
}
/** Worker-local ellipse edge and its four backend records, separate from child sources. */
export class SketchEllipseBackend {
  #oc: Kernel;
  #edge: Handle | undefined;
  #records: ReferenceVector[] = [];
  #request: SketchEllipseBackendRequest | undefined;
  #disposed = false;
  constructor(oc: Kernel) {
    this.#oc = oc;
  }
  #requireLive() {
    if (this.#disposed) throw new Error("Sketch ellipse backend is disposed.");
  }
  #reset() {
    const old = this.#edge;
    this.#edge = undefined;
    this.#records = [];
    this.#request = undefined;
    old?.delete();
  }
  get edge() {
    this.#requireLive();
    return this.#edge;
  }
  snapshot() {
    return structuredClone({
      disposed: this.#disposed,
      kind: this.#edge ? ("ellipse" as const) : ("empty" as const),
      records: this.#records,
      request: this.#request,
    });
  }
  rebuild(input: unknown): boolean {
    this.#requireLive();
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Invalid ellipse backend request.");
    const r = input as Record<string, unknown>;
    if (
      r.kind !== "ellipse" ||
      Object.keys(r).some(
        (k) =>
          !["kind", "center", "axis", "majorRadius", "minorRadius"].includes(k),
      )
    )
      throw new Error("Invalid ellipse backend request.");
    const request: SketchEllipseBackendRequest = {
      kind: "ellipse",
      center: point(r.center),
      axis: point(r.axis),
      majorRadius: finite(r.majorRadius),
      minorRadius: finite(r.minorRadius),
    };
    // Native reset precedes kernel construction. Finite invalid geometry may
    // throw from the kernel; do not invent a circle-style radius threshold.
    this.#reset();
    const {
      center: c,
      axis: a,
      majorRadius: major,
      minorRadius: minor,
    } = request;
    const records: ReferenceVector[] = [
      [
        finite(c[0] - major * a[0]),
        finite(c[1] - major * a[1]),
        finite(c[2] - major * a[2]),
      ],
      [
        finite(major * a[0] + c[0]),
        finite(major * a[1] + c[1]),
        finite(major * a[2] + c[2]),
      ],
      [
        finite(-(a[1] * minor) + c[0]),
        finite(a[0] * minor + c[1]),
        finite(a[2] * minor + c[2]),
      ],
      [
        finite(c[0] - -(a[1] * minor)),
        finite(c[1] - a[0] * minor),
        finite(c[2] - a[2] * minor),
      ],
    ];
    const oc = this.#oc,
      handles: Handle[] = [];
    const keep = <T extends Handle>(h: T): T => (handles.push(h), h);
    let candidate: Handle | undefined;
    try {
      try {
        const center = keep(new oc.gp_Pnt_3(...c));
        const normal = keep(new oc.gp_Dir_4(0, 0, 1));
        const axis = keep(new oc.gp_Dir_4(...a));
        const placement = keep(new oc.gp_Ax2_2(center, normal, axis));
        const ellipse = keep(new oc.gp_Elips_2(placement, major, minor));
        const maker = keep(new oc.GC_MakeEllipse_1(ellipse));
        if (!maker.IsDone()) return false;
        const handle = keep(maker.Value());
        if (handle.IsNull()) return false;
        const curve = keep(new oc.Handle_Geom_Curve_2(handle.get()));
        const edgeMaker = keep(new oc.BRepBuilderAPI_MakeEdge_24(curve));
        if (!edgeMaker.IsDone()) return false;
        candidate = edgeMaker.Edge();
      } finally {
        for (let i = handles.length - 1; i >= 0; i--) handles[i].delete();
      }
      if (!candidate || candidate.IsNull()) return false;
      this.#edge = candidate;
      candidate = undefined;
      this.#records = records;
      this.#request = request;
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
