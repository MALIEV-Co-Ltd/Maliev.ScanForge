import type { ReferenceVector } from "../reference-construction-values";
import {
  completeNativeSketchLineRebuild,
  prepareNativeSketchLineCollectionRebuild,
  prepareNativeSketchLineLocalReplacement,
  prepareNativeSketchLinePlacedReplacement,
  prepareNativeSketchLinePointEdit,
  prepareNativeSketchLinePointRecovery,
  prepareNativeSketchLineTransform,
  type NativeSketchLineRebuildPreparation,
  type NativeSketchLineState,
} from "../sketch-line-rebuild";

interface Backend {
  readonly edge: unknown;
  snapshot(): { disposed: boolean; hasCurve: boolean };
  /** Complete backend result, including converted body and first-edge checks. */
  rebuild(input: unknown): boolean;
  midpoint(): ReferenceVector | undefined;
  dispose(): void;
}
interface Attempt {
  backendSucceeded?: boolean;
  builderSucceeded: boolean;
  error?: string;
}
interface Outcome {
  admitted: boolean;
  attempts: Attempt[];
  builderSucceeded: boolean;
}
const ownedBackends = new WeakSet<Backend>();
function cancelled() {
  const error = new Error("Sketch line child rebuild cancelled.");
  error.name = "AbortError";
  return error;
}
function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw cancelled();
}

/**
 * Uncommitted child state with exclusive backend ownership. A primary edge or
 * checked wire candidate cannot stand in for the backend's full success result.
 * Exception diagnostics and cancellation belong to application staging, not a
 * reconstruction of the native protected error-transfer mechanism.
 */
export class SketchLineChild {
  #backend: Backend;
  #state: NativeSketchLineState | undefined;
  #outcome: Outcome | undefined;
  #disposed = false;

  constructor(initial: NativeSketchLineState, backend: Backend) {
    if (ownedBackends.has(backend))
      throw new Error("Line child backend is already owned.");
    const snapshot = backend.snapshot();
    if (snapshot.disposed || snapshot.hasCurve)
      throw new Error("Line child requires a fresh empty backend.");
    this.#state = completeNativeSketchLineRebuild(
      { state: initial, backendRequest: undefined },
      false,
    ).state;
    this.#backend = backend;
    ownedBackends.add(backend);
  }
  #live(signal?: AbortSignal) {
    if (this.#disposed) throw new Error("Sketch line child is disposed.");
    abort(signal);
  }
  /** Borrowed worker-local handle, invalidated by backend rebuild or disposal. */
  get edge() {
    this.#live();
    return this.#backend.edge;
  }
  snapshot() {
    return structuredClone({
      kind: "line" as const,
      disposed: this.#disposed,
      state: this.#state,
      preparation: this.#state
        ? {
            frame: this.#state.frame,
            sourceRecords: this.#state.sourceRecords,
          }
        : undefined,
      outcome: this.#outcome,
      backend: this.#backend.snapshot(),
    });
  }
  rebuildRecords(records: unknown, signal?: AbortSignal) {
    this.#live(signal);
    const preparation = prepareNativeSketchLineCollectionRebuild(
      records,
      this.#state!,
    );
    return this.#run(preparation, !!preparation.backendRequest, signal);
  }
  replaceLocalRecords(records: unknown, signal?: AbortSignal) {
    this.#live(signal);
    return this.#run(
      prepareNativeSketchLineLocalReplacement(records, this.#state!),
      true,
      signal,
    );
  }
  replacePlacedRecords(records: unknown, frame: unknown, signal?: AbortSignal) {
    this.#live(signal);
    return this.#run(
      prepareNativeSketchLinePlacedReplacement(records, frame, this.#state!),
      true,
      signal,
    );
  }
  transformLocalPoints(transform: unknown, signal?: AbortSignal) {
    this.#live(signal);
    return this.#run(
      prepareNativeSketchLineTransform(transform, this.#state!),
      true,
      signal,
    );
  }
  editPoint(index: number, point: unknown, signal?: AbortSignal) {
    this.#live(signal);
    const edit = prepareNativeSketchLinePointEdit(index, point, this.#state!);
    return this.#run(
      edit.candidate,
      edit.admitted,
      signal,
      edit.admitted
        ? () => prepareNativeSketchLinePointRecovery(edit)
        : undefined,
    );
  }
  #run(
    preparation: NativeSketchLineRebuildPreparation,
    admitted: boolean,
    signal?: AbortSignal,
    recovery?: () => NativeSketchLineRebuildPreparation,
  ) {
    abort(signal);
    const outcome: Outcome = {
      admitted,
      attempts: [],
      builderSucceeded: false,
    };
    this.#outcome = outcome;
    const attempt = (p: NativeSketchLineRebuildPreparation): boolean => {
      this.#state = p.state;
      if (!p.backendRequest) return false;
      const result: Attempt = { builderSucceeded: false };
      outcome.attempts.push(result);
      try {
        const succeeded = this.#backend.rebuild(
          structuredClone(p.backendRequest),
        );
        this.#live(signal);
        if (typeof succeeded !== "boolean")
          throw new Error("Line backend result must be boolean.");
        result.backendSucceeded = succeeded;
        const completed = completeNativeSketchLineRebuild(
          p,
          succeeded,
          succeeded ? this.#backend.midpoint() : undefined,
        );
        this.#live(signal);
        this.#state = completed.state;
        result.builderSucceeded = completed.builderSucceeded;
        outcome.builderSucceeded = completed.builderSucceeded;
        return completed.builderSucceeded;
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    };
    let failed = false;
    let failure: unknown;
    try {
      if (!attempt(preparation) && recovery) {
        abort(signal);
        attempt(recovery());
      }
      return structuredClone(outcome);
    } catch (error) {
      failed = true;
      failure = error;
      throw error;
    } finally {
      if (signal?.aborted) {
        const cancellation = cancelled();
        const errors: unknown[] = [cancellation];
        if (
          failed &&
          !(failure instanceof Error && failure.name === "AbortError")
        )
          errors.push(failure);
        try {
          this.dispose();
        } catch (error) {
          errors.push(error);
        }
        if (errors.length > 1)
          throw new AggregateError(
            errors,
            "Sketch line child cancelled with failures.",
          );
        throw cancellation;
      }
    }
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#state = undefined;
    this.#outcome = undefined;
    this.#backend.dispose();
  }
}
