import { resolveNativeSketchWireValidation } from "../sketch-wire-validation";
import { checkNativeSketchLineSelfConnection } from "../sketch-line-self-connection";
import { checkNativeSketchLineInputInterval } from "../sketch-line-projection";
import { createPreparedSketchDirection } from "./sketch-prepared-direction";
import { resolveNativeSketchLineAttachment } from "../sketch-wire-attachment";
import {
  requireNativeSketchLinePreparedEndpoints,
  type NativeSketchLinePreparedEndpoints,
} from "../sketch-line-prepared";
import {
  checkNativeSketchFreshLineGeometry,
  type NativeSketchFreshLineGeometryChecks,
} from "../sketch-line-geometry";

type Handle = { delete(): void };
type Shape = Handle & { IsNull(): boolean };
type Kernel = Record<string, any>;
function retire(handles: Handle[]): unknown[] {
  const errors: unknown[] = [];
  for (let i = handles.length - 1; i >= 0; i--) {
    try {
      handles[i].delete();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

export type SketchLineCheckedWireAttempt = {
  status: "geometry-rejected" | "kernel-rejected" | "candidate";
  checks: NativeSketchFreshLineGeometryChecks;
  candidate?: SketchLineWireCandidate;
};

/**
 * Owns a real converted wire candidate and a separately owned first-edge handle.
 * Kernel validity is not original-native admission. Requested tolerance is
 * explicit; OCCT may report a larger tolerance floor. Native semantic checks
 * must use their own explicit settings, not that kernel-reported value.
 */
export class SketchLineWireCandidate {
  #wire: Shape | undefined;
  #firstEdge: Shape | undefined;
  #request: NativeSketchLinePreparedEndpoints | undefined;
  #requestedTolerance: number | undefined;
  #disposed = false;
  private constructor(
    wire: Shape,
    firstEdge: Shape,
    request: NativeSketchLinePreparedEndpoints,
    tolerance: number,
  ) {
    this.#wire = wire;
    this.#firstEdge = firstEdge;
    this.#request = request;
    this.#requestedTolerance = tolerance;
  }
  static createChecked(
    oc: Kernel,
    input: unknown,
    settings: unknown,
  ): SketchLineCheckedWireAttempt {
    const checks = checkNativeSketchFreshLineGeometry(input, settings);
    if (!checks.passed) return { status: "geometry-rejected", checks };
    const candidate = SketchLineWireCandidate.create(
      oc,
      checks.prepared,
      checks.vertexTolerance,
    );
    return {
      status: candidate ? "candidate" : "kernel-rejected",
      checks,
      ...(candidate ? { candidate } : {}),
    };
  }
  static create(
    oc: Kernel,
    input: unknown,
    requestedTolerance: unknown,
  ): SketchLineWireCandidate | undefined {
    const request = requireNativeSketchLinePreparedEndpoints(input);
    if (
      typeof requestedTolerance !== "number" ||
      !Number.isFinite(requestedTolerance) ||
      requestedTolerance < 0
    )
      throw new Error(
        "Line wire candidate requires an explicit finite nonnegative tolerance.",
      );
    const { conversion, start, end } = request;
    if (conversion.interval[1] <= conversion.interval[0]) return undefined;
    const handles: Handle[] = [];
    const keep = <T extends Handle>(h: T): T => (handles.push(h), h);
    let built: { wire: Shape; firstEdge: Shape } | undefined;
    let thrown = false,
      failure: unknown;
    try {
      built = (() => {
        const origin = keep(new oc.gp_Pnt_3(...conversion.origin));
        const direction = keep(
          createPreparedSketchDirection(oc, conversion.direction),
        );
        const line = keep(new oc.gp_Lin_3(origin, direction));
        const segment = keep(
          new oc.GC_MakeSegment_2(line, ...conversion.interval),
        );
        if (!segment.IsDone()) return undefined;
        const trimmed = keep(segment.Value());
        if (trimmed.IsNull()) return undefined;
        const curve = keep(new oc.Handle_Geom_Curve_2(trimmed.get()));
        const firstPoint = keep(new oc.gp_Pnt_3(...start));
        const lastPoint = keep(new oc.gp_Pnt_3(...end));
        const builder = keep(new oc.BRep_Builder());
        const firstVertex = keep(new oc.TopoDS_Vertex());
        const lastVertex = keep(new oc.TopoDS_Vertex());
        builder.MakeVertex_2(firstVertex, firstPoint, requestedTolerance);
        builder.MakeVertex_2(lastVertex, lastPoint, requestedTolerance);
        const edge = keep(new oc.TopoDS_Edge());
        // The high-level maker rejects short intervals independently of native
        // admission. Build explicit topology, then validate the resulting wire.
        builder.MakeEdge_2(edge, curve, requestedTolerance);
        if (edge.IsNull()) return undefined;
        builder.Range_1(edge, ...conversion.interval, true);
        firstVertex.Orientation_2(oc.TopAbs_Orientation.TopAbs_FORWARD);
        lastVertex.Orientation_2(oc.TopAbs_Orientation.TopAbs_REVERSED);
        builder.Add(edge, firstVertex);
        builder.Add(edge, lastVertex);
        builder.UpdateVertex_2(
          firstVertex,
          conversion.interval[0],
          edge,
          requestedTolerance,
        );
        builder.UpdateVertex_2(
          lastVertex,
          conversion.interval[1],
          edge,
          requestedTolerance,
        );
        const maker = keep(new oc.BRepBuilderAPI_MakeWire_1());
        maker.Add_1(edge);
        if (!maker.IsDone()) return undefined;
        const wire = keep(maker.Wire());
        if (wire.IsNull()) return undefined;
        const check = keep(new oc.BRepCheck_Analyzer(wire, true));
        if (!check.IsValid_2()) return undefined;
        const explorer = keep(
          new oc.TopExp_Explorer_2(
            wire,
            oc.TopAbs_ShapeEnum.TopAbs_EDGE,
            oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
          ),
        );
        if (!explorer.More()) return undefined;
        const raw = keep(explorer.Current());
        const firstEdge = keep(oc.TopoDS.Edge_1(raw));
        if (firstEdge.IsNull()) return undefined;
        return { wire, firstEdge };
      })();
    } catch (error) {
      thrown = true;
      failure = error;
    }
    const retained = built ? [built.wire, built.firstEdge] : [];
    const errors = retire(
      handles.filter((h) => !retained.includes(h as Shape)),
    );
    if (thrown || errors.length) {
      errors.push(...retire(retained));
      if (errors.length)
        throw new AggregateError(
          thrown ? [failure, ...errors] : errors,
          "Line wire candidate cleanup failed.",
        );
      throw failure;
    }
    return built
      ? new SketchLineWireCandidate(
          built.wire,
          built.firstEdge,
          request,
          requestedTolerance,
        )
      : undefined;
  }
  #live() {
    if (this.#disposed) throw new Error("Line wire candidate is disposed.");
  }
  /** Borrowed worker-local handles; invalidated by dispose. */
  get wire() {
    this.#live();
    return this.#wire!;
  }
  get firstEdge() {
    this.#live();
    return this.#firstEdge!;
  }
  snapshot() {
    return structuredClone({
      disposed: this.#disposed,
      hasWire: !!this.#wire,
      hasFirstEdge: !!this.#firstEdge,
      ...(this.#request
        ? {
            request: this.#request,
            requestedTolerance: this.#requestedTolerance,
          }
        : {}),
    });
  }
  /** Read-only connection diagnostic; it does not close or authorize the wire. */
  checkSelfConnection(squaredThreshold: unknown) {
    this.#live();
    return checkNativeSketchLineSelfConnection(this.#request, squaredThreshold);
  }
  /** Conditional input-range diagnostic; runtime threshold must be supplied. */
  checkInputInterval(parameterZeroThreshold: unknown) {
    this.#live();
    const interval = this.#request!.conversion.interval;
    return checkNativeSketchLineInputInterval(
      interval[0],
      interval[1],
      parameterZeroThreshold,
    );
  }
  /** Supplied attachment event only; continuation does not imply admission. */
  applyAttachmentResult(input: unknown) {
    this.#live();
    const result = resolveNativeSketchLineAttachment(input);
    if (!result.continues) this.dispose();
    return result;
  }
  /** Supplied native normal-return results; retention does not imply admission. */
  applyValidationResult(input: unknown) {
    this.#live();
    const result = resolveNativeSketchWireValidation(input);
    if (!result.retainCandidate) this.dispose();
    return result;
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    const handles = [this.#wire!, this.#firstEdge!];
    this.#wire = undefined;
    this.#firstEdge = undefined;
    this.#request = undefined;
    this.#requestedTolerance = undefined;
    const errors = retire(handles);
    if (errors.length)
      throw new AggregateError(errors, "Line wire candidate cleanup failed.");
  }
}
