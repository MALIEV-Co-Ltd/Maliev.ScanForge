import {
  prepareNativeSketchEllipseCollectionRebuild,
  prepareNativeSketchEllipsePointEdit,
  prepareNativeSketchEllipsePlacedReplacement,
  type NativeSketchEllipsePreparation,
  type SketchEllipseBackendRequest,
  type NativeSketchEllipseGeometry,
} from "../sketch-ellipse-rebuild.ts";
import { copySketchSourceRecordStore } from "../sketch-source-records.ts";
import type { SketchSourceRecordStore } from "../sketch-source-records.ts";
import type { ReferenceVector } from "../reference-construction-values";
interface Backend {
  readonly edge: unknown;
  snapshot(): {
    disposed: boolean;
    kind: "ellipse" | "empty";
    records: number[][];
  };
  rebuild(input: unknown): boolean;
  dispose(): void;
}
interface Outcome {
  backendAttempted: boolean;
  backendSucceeded: boolean | undefined;
  builderSucceeded: boolean;
  error: string | undefined;
}
/** Internal structured-clone state, not a project/editor sketch format. */
export interface SketchEllipseChildState {
  version: 1;
  kind: "ellipse";
  frame: SketchSourceRecordStore["frame"];
  backendEmpty: boolean;
  preparation: NativeSketchEllipsePreparation | undefined;
  outcome: Outcome | undefined;
  lastBackendRequest: SketchEllipseBackendRequest | undefined;
}
function stateObject(value: unknown, fields: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new Error("Invalid ellipse child state object.");
  return value as Record<string, unknown>;
}
function stateVector(value: unknown): ReferenceVector {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !Array.from(value).every((n) => typeof n === "number" && Number.isFinite(n))
  )
    throw new Error("Invalid ellipse child state coordinates.");
  return [...value] as unknown as ReferenceVector;
}
function stateNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Invalid ellipse child state number.");
  return value;
}
function stateFlag(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new Error("Invalid ellipse child state flag.");
  return value;
}
function stateRequest(value: unknown): SketchEllipseBackendRequest | undefined {
  if (value === undefined) return undefined;
  const r = stateObject(value, [
    "kind",
    "center",
    "axis",
    "majorRadius",
    "minorRadius",
  ]);
  if (r.kind !== "ellipse")
    throw new Error("Ellipse child backend kind mismatch.");
  return {
    kind: "ellipse",
    center: stateVector(r.center),
    axis: stateVector(r.axis),
    majorRadius: stateNumber(r.majorRadius),
    minorRadius: stateNumber(r.minorRadius),
  };
}
function copyState(value: unknown): SketchEllipseChildState {
  const s = stateObject(value, [
    "version",
    "kind",
    "frame",
    "backendEmpty",
    "preparation",
    "outcome",
    "lastBackendRequest",
  ]);
  if (s.version !== 1 || s.kind !== "ellipse")
    throw new Error("Unsupported ellipse child state version or kind.");
  const frame = copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: s.frame,
    children: [],
  }).frame;
  const backendEmpty = stateFlag(s.backendEmpty);
  let preparation: NativeSketchEllipsePreparation | undefined;
  if (s.preparation !== undefined) {
    const p = stateObject(s.preparation, [
      "frame",
      "sourceRecords",
      "geometry",
      "fitSucceeded",
      "backendRequest",
    ]);
    const source = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: p.frame,
      children: [{ id: "", kind: "ellipse", records: p.sourceRecords }],
    });
    if (
      !source.children[0].records ||
      !frame.every((row, i) =>
        row.every((n, j) => Object.is(n, source.frame[i][j])),
      )
    )
      throw new Error("Invalid ellipse child source records or frame.");
    let geometry: NativeSketchEllipseGeometry | undefined;
    if (p.geometry !== undefined) {
      const g = stateObject(p.geometry, [
        "center",
        "axis",
        "radius1",
        "radius2",
      ]);
      geometry = {
        center: stateVector(g.center),
        axis: stateVector(g.axis),
        radius1: stateNumber(g.radius1),
        radius2: stateNumber(g.radius2),
      };
    }
    preparation = {
      frame: source.frame,
      sourceRecords: source.children[0].records,
      geometry,
      fitSucceeded:
        p.fitSucceeded === undefined ? undefined : stateFlag(p.fitSucceeded),
      backendRequest: stateRequest(p.backendRequest),
    };
  }
  let outcome: Outcome | undefined;
  if (s.outcome !== undefined) {
    const o = stateObject(s.outcome, [
      "backendAttempted",
      "backendSucceeded",
      "builderSucceeded",
      "error",
    ]);
    if (o.error !== undefined && typeof o.error !== "string")
      throw new Error("Invalid ellipse child outcome error.");
    outcome = {
      backendAttempted: stateFlag(o.backendAttempted),
      backendSucceeded:
        o.backendSucceeded === undefined
          ? undefined
          : stateFlag(o.backendSucceeded),
      builderSucceeded: stateFlag(o.builderSucceeded),
      error: o.error,
    };
  }
  const lastBackendRequest = stateRequest(s.lastBackendRequest);
  if (
    (preparation === undefined) !== (outcome === undefined) ||
    (!preparation && lastBackendRequest) ||
    (!backendEmpty && !lastBackendRequest)
  )
    throw new Error("Incomplete ellipse child restoration state.");
  return {
    version: 1,
    kind: "ellipse",
    frame,
    backendEmpty,
    preparation,
    outcome,
    lastBackendRequest,
  };
}
function abort(signal?: AbortSignal) {
  if (signal?.aborted) {
    const e = new Error("Sketch ellipse operation aborted.");
    e.name = "AbortError";
    throw e;
  }
}
/** Uncommitted ellipse child; retained sources and kernel state remain separate. */
export class SketchEllipseChild {
  #frame;
  #backend: Backend;
  #preparation: NativeSketchEllipsePreparation | undefined;
  #outcome: Outcome | undefined;
  #lastBackendRequest: SketchEllipseBackendRequest | undefined;
  #disposed = false;
  constructor(frame: unknown, backend: Backend) {
    this.#frame = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame,
      children: [],
    }).frame;
    const initial = backend.snapshot();
    if (initial.disposed || initial.kind !== "empty")
      throw new Error("Ellipse child requires a fresh empty backend.");
    this.#backend = backend;
  }
  #requireLive() {
    if (this.#disposed) throw new Error("Sketch ellipse child is disposed.");
  }
  get edge() {
    this.#requireLive();
    return this.#backend.edge;
  }
  snapshot() {
    return structuredClone({
      kind: "ellipse" as const,
      disposed: this.#disposed,
      frame: this.#frame,
      preparation: this.#preparation,
      outcome: this.#outcome,
      backend: this.#backend.snapshot(),
    });
  }
  /** Keeps Float64 values/undefined intact; external storage owns its exact codec. */
  exportState(): SketchEllipseChildState {
    this.#requireLive();
    return copyState({
      version: 1,
      kind: "ellipse",
      frame: this.#frame,
      backendEmpty: this.#backend.snapshot().kind === "empty",
      preparation: this.#preparation,
      outcome: this.#outcome,
      lastBackendRequest: this.#lastBackendRequest,
    });
  }
  static restoreState(
    input: unknown,
    createBackend: () => Backend,
    signal?: AbortSignal,
  ): SketchEllipseChild {
    const state = copyState(input);
    abort(signal);
    const backend = createBackend();
    let child: SketchEllipseChild | undefined;
    try {
      child = new SketchEllipseChild(state.frame, backend);
      abort(signal);
      if (
        !state.backendEmpty &&
        !backend.rebuild(structuredClone(state.lastBackendRequest))
      )
        throw new Error("Cannot restore ellipse backend geometry.");
      abort(signal);
      child.#preparation = state.preparation;
      child.#outcome = state.outcome;
      child.#lastBackendRequest = state.lastBackendRequest;
      return child;
    } catch (error) {
      if (child) child.dispose();
      else backend.dispose();
      throw error;
    }
  }
  rebuildRecords(records: unknown, signal?: AbortSignal) {
    this.#requireLive();
    abort(signal);
    const preparation = prepareNativeSketchEllipseCollectionRebuild(
      records,
      this.#frame,
      this.#preparation?.geometry,
    );
    return this.#applyPreparation(preparation, signal);
  }
  editPoint(index: number, target: unknown, signal?: AbortSignal) {
    this.#requireLive();
    abort(signal);
    if (!this.#preparation)
      throw new Error("Ellipse point edit requires prepared geometry.");
    const result = prepareNativeSketchEllipsePointEdit(
      index,
      target,
      this.#preparation,
    );
    abort(signal);
    if (result.changed)
      return this.#applyPreparation(result.preparation, signal);
    this.#outcome = {
      backendAttempted: false,
      backendSucceeded: undefined,
      builderSucceeded: false,
      error: undefined,
    };
    return structuredClone(this.#outcome);
  }
  replacePlacedRecords(
    records: unknown,
    placement: unknown,
    signal?: AbortSignal,
  ) {
    this.#requireLive();
    abort(signal);
    const previous =
      this.#preparation ??
      prepareNativeSketchEllipseCollectionRebuild([], this.#frame);
    return this.#applyPreparation(
      prepareNativeSketchEllipsePlacedReplacement(records, placement, previous),
      signal,
    );
  }
  #applyPreparation(
    preparation: NativeSketchEllipsePreparation,
    signal?: AbortSignal,
  ) {
    abort(signal);
    this.#preparation = preparation;
    this.#frame = preparation.frame;
    const outcome: Outcome = {
      backendAttempted: false,
      backendSucceeded: undefined,
      builderSucceeded: false,
      error: undefined,
    };
    this.#outcome = outcome;
    try {
      if (preparation.backendRequest) {
        outcome.backendAttempted = true;
        outcome.backendSucceeded = this.#backend.rebuild(
          preparation.backendRequest,
        );
        outcome.builderSucceeded = outcome.backendSucceeded;
        if (outcome.backendSucceeded)
          this.#lastBackendRequest = structuredClone(
            preparation.backendRequest,
          );
      }
      return structuredClone(outcome);
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      if (signal?.aborted) {
        this.dispose();
        abort(signal);
      }
    }
  }
  fork(createBackend: () => Backend, signal?: AbortSignal): SketchEllipseChild {
    this.#requireLive();
    return SketchEllipseChild.restoreState(
      this.exportState(),
      () => {
        const backend = createBackend();
        if (backend === this.#backend)
          throw new Error("A staged copy requires an independent backend.");
        return backend;
      },
      signal,
    );
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#preparation = undefined;
    this.#outcome = undefined;
    this.#lastBackendRequest = undefined;
    this.#backend.dispose();
  }
}
