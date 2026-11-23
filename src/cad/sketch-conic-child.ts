import {
  prepareNativeSketchArcRebuild,
  prepareNativeSketchArcLocalReplacement,
  prepareNativeSketchArcPlacedReplacement,
  prepareNativeSketchArcPointEdit,
  prepareNativeSketchArcTransform,
  prepareNativeSketchArcCollectionRebuild,
  type NativeSketchArcRebuildPreparation,
} from "../sketch-arc-rebuild.ts";
import {
  prepareNativeSketchCircleRebuild,
  prepareNativeSketchCirclePointEdit,
  prepareNativeSketchCircleTransform,
  prepareNativeSketchCircleRadiusEdit,
  prepareNativeSketchCircleLocalReplacement,
  prepareNativeSketchCircleCollectionRebuild,
  prepareNativeSketchCirclePlacedReplacement,
  type NativeSketchCircleRebuildPreparation,
} from "../sketch-circle-rebuild.ts";

type Kind = "arc" | "circle";
type Preparation =
  NativeSketchArcRebuildPreparation | NativeSketchCircleRebuildPreparation;
interface BackendSnapshot {
  disposed: boolean;
  kind: "empty" | Kind;
  records: number[][];
  radius?: number;
}
interface Backend {
  readonly edge: unknown;
  rebuild(input: unknown): boolean;
  snapshot(): BackendSnapshot;
  dispose(): void;
}
interface Outcome {
  backendAttempted: boolean;
  backendSucceeded: boolean | undefined;
  builderSucceeded: boolean;
  error: string | undefined;
}

function cancelled(): Error {
  const error = new Error("Sketch child rebuild cancelled.");
  error.name = "AbortError";
  return error;
}

/**
 * Owns one uncommitted worker-local conic child and its real kernel backend.
 * Retained source records, internal preparation, last builder outcome and
 * current backend validity are separate facts. No editor/history publication
 * or native outer rollback is implied by this internal lifecycle.
 *
 * An abort before work preserves the child; one observed after synchronous
 * kernel work disposes this entire staged child. It cannot interrupt WASM.
 * Worker termination remains the existing in-flight reset/cancellation path.
 */
export class SketchConicChild {
  #kind: Kind;
  #backend: Backend;
  #preparation: Preparation | undefined;
  // The current edge may predate a failed fit. Preserve its own input rather
  // than reconstructing it from the latest preparation/source collection.
  #lastBackendRequest: Preparation["backendRequest"];
  #outcome: Outcome | undefined;
  #disposed = false;

  constructor(kind: Kind, backend: Backend) {
    if (kind !== "arc" && kind !== "circle")
      throw new Error("Unsupported conic child kind.");
    const initial = backend.snapshot();
    if (initial.disposed || initial.kind !== "empty")
      throw new Error("Conic child requires a fresh empty backend.");
    this.#kind = kind;
    this.#backend = backend;
  }

  #requireLive() {
    if (this.#disposed) throw new Error("Sketch conic child is disposed.");
  }

  /** Borrowed inside this worker only. Never publish the native handle. */
  get edge() {
    this.#requireLive();
    return this.#backend.edge;
  }

  snapshot() {
    const backend = this.#backend.snapshot();
    const preparation = this.#preparation;
    const radius =
      preparation &&
      ("radius" in preparation
        ? preparation.radius
        : preparation.backendRequest.radius);
    const validity: "uninitialized" | "valid" | "invalid" = this.#disposed
      ? "invalid"
      : radius === undefined
        ? "uninitialized"
        : radius > 0 && backend.kind !== "empty" && backend.records.length > 0
          ? "valid"
          : "invalid";
    return structuredClone({
      kind: this.#kind,
      disposed: this.#disposed,
      preparation,
      outcome: this.#outcome,
      backend,
      validity,
    });
  }

  /**
   * Application staging copy with independent kernel ownership. This preserves
   * the latest source/diagnostic state AND a possibly older retained edge. It is
   * not a native clone operation or a persisted/public editor transaction.
   * The factory must return a fresh empty backend owned by this new child.
   */
  fork(createBackend: () => Backend, signal?: AbortSignal): SketchConicChild {
    this.#requireLive();
    if (signal?.aborted) throw cancelled();
    const backend = createBackend();
    if (backend === this.#backend)
      throw new Error("A staged copy requires an independent backend.");
    const copy = new SketchConicChild(this.#kind, backend);
    try {
      if (signal?.aborted) throw cancelled();
      if (this.#backend.snapshot().kind !== "empty") {
        if (!this.#lastBackendRequest)
          throw new Error("Cannot restore child backend without its input.");
        const request = structuredClone(this.#lastBackendRequest);
        if (!backend.rebuild(request))
          throw new Error("Cannot restore child backend geometry.");
        copy.#lastBackendRequest = request;
      }
      if (signal?.aborted) throw cancelled();
      copy.#preparation = structuredClone(this.#preparation);
      copy.#outcome = structuredClone(this.#outcome);
      return copy;
    } catch (error) {
      copy.dispose();
      throw error;
    }
  }

  rebuild(input: unknown, signal?: AbortSignal) {
    this.#requireLive();
    if (signal?.aborted) throw cancelled();
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Invalid conic rebuild request.");
    const request = input as Record<string, unknown>;
    const fields =
      this.#kind === "arc"
        ? ["kind", "points", "frame", "close"]
        : ["kind", "points", "frame"];
    if (
      request.kind !== this.#kind ||
      Object.keys(request).some((key) => !fields.includes(key))
    )
      throw new Error("Invalid conic rebuild kind or field.");
    let preparation: Preparation;
    if (this.#kind === "arc") {
      const prior = this.#preparation as
        NativeSketchArcRebuildPreparation | undefined;
      preparation = prepareNativeSketchArcRebuild(
        request.points,
        request.frame,
        {
          // Constructor/allocator evidence does not establish an initial radius.
          // Preserve that uncertainty rather than inventing a numerical value.
          radius: prior?.radius,
          closed: prior?.closed ?? false,
          sourceRecords: prior?.sourceRecords ?? [],
        },
        request.close,
      );
    } else
      preparation = prepareNativeSketchCircleRebuild(
        request.points,
        request.frame,
      );
    return this.#applyPreparation(preparation, signal);
  }

  /** Native local record replacement; distinct from rebuilding or point edits. */
  replaceLocalArcRecords(records: unknown, signal?: AbortSignal) {
    this.#requireLive();
    if (signal?.aborted) throw cancelled();
    if (this.#kind !== "arc")
      throw new Error("Local arc record replacement requires an arc child.");
    if (!this.#preparation)
      throw new Error(
        "Local arc record replacement requires a prepared child.",
      );
    const { preparation } = prepareNativeSketchArcLocalReplacement(
      records,
      this.#preparation as NativeSketchArcRebuildPreparation,
    );
    return this.#applyPreparation(preparation, signal);
  }

  /** Replace world records using the explicitly supplied comparison frame. */
  replacePlacedArcRecords(
    records: unknown,
    frame: unknown,
    signal?: AbortSignal,
  ) {
    this.#requireLive();
    if (signal?.aborted) throw cancelled();
    if (this.#kind !== "arc")
      throw new Error("Placed arc record replacement requires an arc child.");
    if (!this.#preparation)
      throw new Error(
        "Placed arc record replacement requires a prepared child.",
      );
    const { preparation } = prepareNativeSketchArcPlacedReplacement(
      records,
      frame,
      this.#preparation as NativeSketchArcRebuildPreparation,
    );
    return this.#applyPreparation(preparation, signal);
  }

  /** Edit a local defining point (0..2) or translate the center in XY (3). */
  editArcPoint(index: unknown, point: unknown, signal?: AbortSignal) {
    this.#requireLive();
    if (signal?.aborted) throw cancelled();
    if (this.#kind !== "arc")
      throw new Error("Arc point editing requires an arc child.");
    if (!this.#preparation)
      throw new Error("Arc point editing requires a prepared child.");
    const { preparation } = prepareNativeSketchArcPointEdit(
      index,
      point,
      this.#preparation as NativeSketchArcRebuildPreparation,
    );
    return this.#applyPreparation(preparation, signal);
  }

  /** Transform internal local points and refit; stored placement is unchanged. */
  transformArcLocalPoints(transform: unknown, signal?: AbortSignal) {
    this.#requireLive();
    if (signal?.aborted) throw cancelled();
    if (this.#kind !== "arc")
      throw new Error("Local arc transformation requires an arc child.");
    if (!this.#preparation)
      throw new Error("Local arc transformation requires a prepared child.");
    const preparation = prepareNativeSketchArcTransform(
      transform,
      this.#preparation as NativeSketchArcRebuildPreparation,
    );
    return this.#applyPreparation(preparation, signal);
  }

  /** Refit first three local records with the child's existing closure flag. */
  rebuildArcRecords(records: unknown, signal?: AbortSignal) {
    this.#requireLive();
    if (signal?.aborted) throw cancelled();
    if (this.#kind !== "arc")
      throw new Error("Arc collection rebuilding requires an arc child.");
    if (!this.#preparation)
      throw new Error("Arc collection rebuilding requires a prepared child.");
    const preparation = prepareNativeSketchArcCollectionRebuild(
      records,
      this.#preparation as NativeSketchArcRebuildPreparation,
    );
    return this.#applyPreparation(preparation, signal);
  }

  /** Circle defining-point refit or center translation without refitting. */
  editCirclePoint(index: unknown, point: unknown, signal?: AbortSignal) {
    this.#requireLive();
    if (signal?.aborted) throw cancelled();
    if (this.#kind !== "circle")
      throw new Error("Circle point editing requires a circle child.");
    if (!this.#preparation)
      throw new Error("Circle point editing requires a prepared child.");
    return this.#applyPreparation(
      prepareNativeSketchCirclePointEdit(
        index,
        point,
        this.#preparation as NativeSketchCircleRebuildPreparation,
      ),
      signal,
    );
  }

  /** Refit transformed circle defining points with stored placement. */
  transformCircleLocalPoints(transform: unknown, signal?: AbortSignal) {
    this.#requireLive();
    if (signal?.aborted) throw cancelled();
    if (this.#kind !== "circle")
      throw new Error("Local circle transformation requires a circle child.");
    if (!this.#preparation)
      throw new Error("Local circle transformation requires a prepared child.");
    return this.#applyPreparation(
      prepareNativeSketchCircleTransform(
        transform,
        this.#preparation as NativeSketchCircleRebuildPreparation,
      ),
      signal,
    );
  }

  /** Resize around the retained center without a three-point fit. */
  editCircleRadius(radius: unknown, signal?: AbortSignal) {
    this.#requireLive();
    if (signal?.aborted) throw cancelled();
    if (this.#kind !== "circle")
      throw new Error("Circle radius editing requires a circle child.");
    if (!this.#preparation)
      throw new Error("Circle radius editing requires a prepared child.");
    return this.#applyPreparation(
      prepareNativeSketchCircleRadiusEdit(
        radius,
        this.#preparation as NativeSketchCircleRebuildPreparation,
      ),
      signal,
    );
  }

  /** Replace local records, permitting XYZ center translation without fitting. */
  replaceLocalCircleRecords(records: unknown, signal?: AbortSignal) {
    this.#requireLive();
    if (signal?.aborted) throw cancelled();
    if (this.#kind !== "circle")
      throw new Error("Local circle replacement requires a circle child.");
    if (!this.#preparation)
      throw new Error("Local circle replacement requires a prepared child.");
    const { preparation } = prepareNativeSketchCircleLocalReplacement(
      records,
      this.#preparation as NativeSketchCircleRebuildPreparation,
    );
    return this.#applyPreparation(preparation, signal);
  }

  /** Always fit the first three collection records with stored placement. */
  rebuildCircleRecords(records: unknown, signal?: AbortSignal) {
    this.#requireLive();
    if (signal?.aborted) throw cancelled();
    if (this.#kind !== "circle")
      throw new Error("Circle collection rebuild requires a circle child.");
    if (!this.#preparation)
      throw new Error("Circle collection rebuild requires a prepared child.");
    return this.#applyPreparation(
      prepareNativeSketchCircleCollectionRebuild(
        records,
        this.#preparation as NativeSketchCircleRebuildPreparation,
      ),
      signal,
    );
  }

  /** Replace world records using an explicitly supplied comparison placement. */
  replacePlacedCircleRecords(
    records: unknown,
    frame: unknown,
    signal?: AbortSignal,
  ) {
    this.#requireLive();
    if (signal?.aborted) throw cancelled();
    if (this.#kind !== "circle")
      throw new Error("Placed circle replacement requires a circle child.");
    if (!this.#preparation)
      throw new Error("Placed circle replacement requires a prepared child.");
    const { preparation } = prepareNativeSketchCirclePlacedReplacement(
      records,
      frame,
      this.#preparation as NativeSketchCircleRebuildPreparation,
    );
    return this.#applyPreparation(preparation, signal);
  }

  #applyPreparation(preparation: Preparation, signal?: AbortSignal) {
    if (signal?.aborted) throw cancelled();
    this.#preparation = preparation;
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
        if (outcome.backendSucceeded)
          this.#lastBackendRequest = structuredClone(
            preparation.backendRequest,
          );
        // The retained-geometry edit route performs no fit but still returns
        // the real backend result. Fit status is a separate diagnostic fact.
        outcome.builderSucceeded = outcome.backendSucceeded;
      }
    } catch (error) {
      outcome.backendSucceeded = false;
      outcome.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      if (signal?.aborted) {
        this.dispose();
        throw cancelled();
      }
    }
    return this.snapshot();
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.#backend.dispose();
    } finally {
      this.#preparation = undefined;
      this.#lastBackendRequest = undefined;
      this.#outcome = undefined;
    }
  }
}
