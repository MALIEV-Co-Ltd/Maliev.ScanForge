import {
  prepareNativeSketchEllipseCollectionRebuild,
  prepareNativeSketchEllipsePointEdit,
  prepareNativeSketchEllipsePlacedReplacement,
  type NativeSketchEllipsePreparation,
  type SketchEllipseBackendRequest,
} from "../sketch-ellipse-rebuild.ts";
import { copySketchSourceRecordStore } from "../sketch-source-records.ts";
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
    abort(signal);
    const backend = createBackend();
    if (backend === this.#backend)
      throw new Error("A staged copy requires an independent backend.");
    const copy = new SketchEllipseChild(this.#frame, backend);
    try {
      abort(signal);
      if (this.#backend.snapshot().kind !== "empty") {
        if (!this.#lastBackendRequest)
          throw new Error("Cannot restore ellipse backend without its input.");
        const request = structuredClone(this.#lastBackendRequest);
        if (!backend.rebuild(request))
          throw new Error("Cannot restore ellipse backend geometry.");
        copy.#lastBackendRequest = request;
      }
      abort(signal);
      copy.#preparation = structuredClone(this.#preparation);
      copy.#outcome = structuredClone(this.#outcome);
      return copy;
    } catch (error) {
      copy.dispose();
      throw error;
    }
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
