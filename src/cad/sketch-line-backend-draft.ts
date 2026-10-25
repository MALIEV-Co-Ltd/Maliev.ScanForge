import {
  SketchLineCurve,
  requireSketchLineCurveRequest,
} from "./sketch-line-curve";
import { SketchLineWireCandidate } from "./sketch-line-wire-candidate";
import { requireSketchLineCoordinateScale } from "../sketch-line-conversion";
import {
  requireNativeSketchLineGeometrySettings,
  type NativeSketchFreshLineGeometryChecks,
} from "../sketch-line-geometry";
import type { NativeSketchWireValidationResult } from "../sketch-wire-validation";
import type { NativeSketchLineAttachmentResult } from "../sketch-wire-attachment";
import type { ReferenceVector } from "../reference-construction-values";

type Status =
  | "primary-rejected"
  | "conversion-rejected"
  | "geometry-rejected"
  | "kernel-rejected"
  | "pending-validation"
  | "validation-retained"
  | "validation-rejected"
  | "attachment-rejected"
  | "error";
interface Attempt {
  status: Status;
  checks?: NativeSketchFreshLineGeometryChecks;
  validation?: NativeSketchWireValidationResult;
  attachment?: NativeSketchLineAttachmentResult;
  error?: string;
  during?: "reset" | "primary" | "conversion" | "attachment" | "validation";
}

/** Owns draft resources only. No full native backend success is inferred. */
export class SketchLineBackendDraft {
  #oc: ConstructorParameters<typeof SketchLineCurve>[0];
  #curve: SketchLineCurve;
  #candidate: SketchLineWireCandidate | undefined;
  #records: ReferenceVector[] = [];
  #kind: "empty" | "line" = "empty";
  #attempt: Attempt | undefined;
  #disposed = false;

  constructor(oc: ConstructorParameters<typeof SketchLineCurve>[0]) {
    this.#oc = oc;
    this.#curve = new SketchLineCurve(oc);
  }
  #live() {
    if (this.#disposed)
      throw new Error("Sketch line backend draft is disposed.");
  }
  #reset() {
    const candidate = this.#candidate;
    this.#candidate = undefined;
    this.#records = [];
    this.#kind = "empty";
    this.#attempt = undefined;
    const errors: unknown[] = [];
    // Native reset clears the primary holder before the converted-body holder.
    try {
      this.#curve.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      candidate?.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, "Line backend draft cleanup failed.");
  }
  /** Borrowed read-only geometry; rebuild and disposal invalidate handles. */
  get edge() {
    this.#live();
    return this.#curve.snapshot().hasCurve ? this.#curve.edge : undefined;
  }
  get wire() {
    this.#live();
    return this.#candidate?.wire;
  }
  get firstEdge() {
    this.#live();
    return this.#candidate?.firstEdge;
  }
  snapshot() {
    return structuredClone({
      disposed: this.#disposed,
      kind: this.#kind,
      records: this.#records,
      hasCurve: this.#curve.snapshot().hasCurve,
      hasBodyCandidate: !!this.#candidate,
      hasFirstEdge: !!this.#candidate,
      ...(this.#attempt ? { attempt: this.#attempt } : {}),
    });
  }
  /** Application staging copy, not native cloning or completed body admission. */
  fork(signal?: AbortSignal): SketchLineBackendDraft {
    const curve = this.#curve,
      candidate = this.#candidate,
      records = this.#records,
      attempt = this.#attempt,
      kind = this.#kind;
    const check = () => {
      this.#live();
      if (signal?.aborted) {
        const error = new Error("Line draft copy cancelled.");
        error.name = "AbortError";
        throw error;
      }
      if (
        this.#curve !== curve ||
        this.#candidate !== candidate ||
        this.#records !== records ||
        this.#attempt !== attempt
      )
        throw new Error("Line draft changed while copying.");
    };
    check();
    const primary = curve.snapshot();
    const prepared = candidate?.snapshot();
    const copy = new SketchLineBackendDraft(this.#oc);
    try {
      if (primary.hasCurve) {
        if (!primary.request || !copy.#curve.rebuildCurve(primary.request))
          throw new Error("Cannot restore line draft primary curve.");
      }
      check();
      if (prepared) {
        copy.#candidate = SketchLineWireCandidate.create(
          this.#oc,
          prepared.request,
          prepared.requestedTolerance,
        );
        if (!copy.#candidate)
          throw new Error("Cannot restore line draft wire candidate.");
      }
      check();
      copy.#records = structuredClone(records);
      copy.#kind = kind;
      copy.#attempt = structuredClone(attempt);
      return copy;
    } catch (error) {
      try {
        copy.dispose();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Line draft copy and cleanup failed.",
        );
      }
      throw error;
    }
  }
  rebuild(input: unknown, coordinateScale: unknown, settings: unknown) {
    this.#live();
    const request = requireSketchLineCurveRequest(input);
    const scale = requireSketchLineCoordinateScale(coordinateScale);
    const resolved = requireNativeSketchLineGeometrySettings(settings);
    let during: "reset" | "primary" | "conversion" = "reset";
    try {
      this.#reset();
      this.#curve = new SketchLineCurve(this.#oc);
      during = "primary";
      if (!this.#curve.rebuildCurve(request)) {
        this.#attempt = { status: "primary-rejected" };
        return this.snapshot();
      }
      during = "conversion";
      const result = this.#curve.prepareBodyCandidate(scale, resolved);
      this.#candidate = result?.candidate;
      // A normally returned body failure still publishes backend kind/records.
      this.#records = request.points.map((p) => [...p] as ReferenceVector);
      this.#kind = "line";
      this.#attempt = result
        ? {
            status:
              result.status === "candidate"
                ? "pending-validation"
                : result.status,
            checks: result.checks,
          }
        : { status: "conversion-rejected" };
      return this.snapshot();
    } catch (error) {
      this.#attempt = {
        status: "error",
        during,
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }
  /** Attachment events precede validation; no completed sequence is inferred. */
  applyAttachmentResult(input: unknown) {
    this.#live();
    const candidate = this.#candidate;
    if (!candidate) throw new Error("No line draft wire candidate.");
    if (this.#attempt?.status !== "pending-validation")
      throw new Error("Line draft attachment requires the construction phase.");
    try {
      const result = candidate.applyAttachmentResult(input);
      this.#attempt = {
        ...this.#attempt,
        status: result.continues ? "pending-validation" : "attachment-rejected",
        attachment: { ...result },
      };
      return result;
    } catch (error) {
      if (candidate.snapshot().disposed)
        this.#attempt = {
          ...this.#attempt,
          status: "error",
          during: "attachment",
          error: error instanceof Error ? error.message : String(error),
        };
      throw error;
    } finally {
      if (candidate.snapshot().disposed) this.#candidate = undefined;
    }
  }
  /** Requires supplied native normal-return results; retention is not admission. */
  applyValidationResult(input: unknown) {
    this.#live();
    const candidate = this.#candidate;
    if (!candidate) throw new Error("No line draft wire candidate.");
    try {
      const result = candidate.applyValidationResult(input);
      this.#attempt = {
        ...this.#attempt,
        status: result.retainCandidate
          ? "validation-retained"
          : "validation-rejected",
        validation: { ...result },
      };
      return result;
    } catch (error) {
      if (candidate.snapshot().disposed)
        this.#attempt = {
          ...this.#attempt,
          status: "error",
          during: "validation",
          error: error instanceof Error ? error.message : String(error),
        };
      throw error;
    } finally {
      if (candidate.snapshot().disposed) this.#candidate = undefined;
    }
  }
  /** Draft body-presence gate only, not a native accepted-builder result. */
  midpoint(): ReferenceVector {
    this.#live();
    return this.#candidate
      ? (this.#curve.evaluateFraction(0.5) ?? [0, 0, 0])
      : [0, 0, 0];
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#reset();
  }
}
