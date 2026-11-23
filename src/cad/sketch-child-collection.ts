import {
  copySketchSourceRecordStore,
  SKETCH_SOURCE_LIMITS,
  type SketchSourceChildKind,
} from "../sketch-source-records.ts";

export interface SketchOwnedChild {
  snapshot(): {
    kind: SketchSourceChildKind;
    disposed: boolean;
    preparation?: { frame: unknown; sourceRecords: unknown };
  };
  dispose(): void;
}
type Entry<Child> = { id: string; child: Child };
const owners = new WeakMap<SketchOwnedChild, object>();

/**
 * Worker-local ordered ownership, separate from public editor/session policy.
 * Source snapshots are derived from current children, never a cached sidecar.
 * Insertion transfers exclusive ownership only after complete validation.
 * Retired children are returned alive for the caller's history/disposal policy.
 * Callers must stage edits independently, then replace the owned child; retained
 * external references must not mutate a child while this collection owns it.
 */
export class SketchChildCollection<Child extends SketchOwnedChild> {
  #base;
  #entries: Entry<Child>[] = [];
  #disposed = false;
  #revision = 0;
  #pending?: { discard(): void };

  constructor(id: string, frame: unknown) {
    this.#base = copySketchSourceRecordStore({
      version: 1,
      id,
      frame,
      children: [],
    });
  }

  #requireLive() {
    if (this.#disposed) throw new Error("Sketch child collection is disposed.");
  }

  #snapshot(entries: readonly Entry<Child>[]) {
    if (entries.length > SKETCH_SOURCE_LIMITS.children)
      throw new Error("Sketch source child budget exceeded.");
    const children = entries.map(({ id, child }) => {
      const state = child.snapshot() as ReturnType<Child["snapshot"]>;
      if (state.disposed)
        throw new Error("Cannot use a disposed sketch child.");
      if (state.preparation)
        copySketchSourceRecordStore({
          version: 1,
          id: "",
          frame: state.preparation.frame,
          children: [],
        });
      return { id, state };
    });
    const sources = copySketchSourceRecordStore({
      ...this.#base,
      children: children.map(({ id, state }) => ({
        id,
        kind: state.kind,
        records: state.preparation?.sourceRecords,
      })),
    });
    // Admit aggregate source sizes before duplicating complete diagnostic state.
    return { sources, children: structuredClone(children) };
  }

  snapshot() {
    this.#requireLive();
    return this.#snapshot(this.#entries);
  }

  get revision() {
    this.#requireLive();
    return this.#revision;
  }

  #prepareSplice(
    index: number,
    deleteCount: number,
    inserted: readonly Entry<Child>[],
    stageOwner?: object,
  ) {
    this.#requireLive();
    if (
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(deleteCount) ||
      index < 0 ||
      deleteCount < 0 ||
      index > this.#entries.length ||
      deleteCount > this.#entries.length - index ||
      !Array.isArray(inserted)
    )
      throw new Error("Invalid sketch child replacement range.");
    const seen = new Set<Child>();
    for (const { child } of inserted) {
      if (
        (owners.has(child) && owners.get(child) !== stageOwner) ||
        seen.has(child)
      )
        throw new Error("Sketch child is already owned or repeated.");
      seen.add(child);
    }
    const incoming = inserted.map(({ id, child }) => ({ id, child }));
    const next = [
      ...this.#entries.slice(0, index),
      ...incoming,
      ...this.#entries.slice(index + deleteCount),
    ];
    const preview = this.#snapshot(next); // Full admission before ownership changes.
    return { incoming, next, preview };
  }

  #commitSplice(
    index: number,
    deleteCount: number,
    incoming: Entry<Child>[],
    next: Entry<Child>[],
  ) {
    const retired = this.#entries.slice(index, index + deleteCount);
    for (const { child } of retired) owners.delete(child);
    for (const { child } of incoming) owners.set(child, this);
    this.#entries = next;
    this.#revision++;
    return retired;
  }

  splice(
    index: number,
    deleteCount: number,
    inserted: readonly Entry<Child>[],
  ): Entry<Child>[] {
    const { incoming, next } = this.#prepareSplice(
      index,
      deleteCount,
      inserted,
    );
    return this.#commitSplice(index, deleteCount, incoming, next);
  }

  /**
   * Takes ownership of independent, already prepared candidates on admission.
   * One pending replacement bounds retained staging to one additional document.
   * Cancellation is checked at call boundaries, never by reentrant disposal.
   * This worker-local revision is not a public editor/session revision.
   */
  stageSplice(
    index: number,
    deleteCount: number,
    inserted: readonly Entry<Child>[],
    signal?: AbortSignal,
  ) {
    this.#requireLive();
    if (this.#pending)
      throw new Error("Sketch child collection already has a pending edit.");
    const requireNotAborted = () => {
      if (signal?.aborted) {
        const error = new Error("Sketch edit aborted.");
        error.name = "AbortError";
        throw error;
      }
    };
    requireNotAborted();
    const { incoming } = this.#prepareSplice(index, deleteCount, inserted);
    requireNotAborted();
    const revision = this.#revision,
      token = {};
    let closed = false;
    const close = () => {
      closed = true;
      this.#pending = undefined;
    };
    const discard = () => {
      if (closed) return;
      close();
      const errors: unknown[] = [];
      for (const { child } of incoming) {
        owners.delete(child);
        try {
          child.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        throw new AggregateError(errors, "Staged sketch child cleanup failed.");
    };
    const checked = <T>(action: () => T): T => {
      if (closed) throw new Error("Sketch edit is closed.");
      try {
        this.#requireLive();
        requireNotAborted();
        if (this.#revision !== revision)
          throw new Error("Sketch edit is stale.");
        return action();
      } catch (error) {
        try {
          discard();
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Sketch edit and cleanup failed.",
          );
        }
        throw error;
      }
    };
    const stage = {
      snapshot: () =>
        checked(() => {
          return this.#prepareSplice(index, deleteCount, incoming, token)
            .preview;
        }),
      accept: () =>
        checked(() => {
          const { next } = this.#prepareSplice(
            index,
            deleteCount,
            incoming,
            token,
          );
          requireNotAborted();
          const retired = this.#commitSplice(
            index,
            deleteCount,
            incoming,
            next,
          );
          close();
          return retired;
        }),
      discard,
    };
    for (const { child } of incoming) owners.set(child, token);
    this.#pending = stage;
    return stage;
  }

  reorder(ids: readonly string[]) {
    this.#requireLive();
    const byId = new Map(this.#entries.map((entry) => [entry.id, entry]));
    if (
      !Array.isArray(ids) ||
      ids.length !== this.#entries.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !byId.has(id))
    )
      throw new Error(
        "Sketch order must be an exact child identity permutation.",
      );
    this.#entries = ids.map((id) => byId.get(id)!);
    this.#revision++;
  }

  /** Copier owns any allocations it makes before throwing or returning. */
  fork(
    copyChild: (child: Child, id: string) => Child,
  ): SketchChildCollection<Child> {
    this.#requireLive();
    const result = new SketchChildCollection<Child>(
      this.#base.id,
      this.#base.frame,
    );
    const copies: Entry<Child>[] = [];
    const seen = new Set<Child>();
    try {
      for (const { id, child } of this.#entries) {
        const copy = copyChild(child, id);
        if (owners.has(copy) || seen.has(copy))
          throw new Error("Copy must be independently owned.");
        seen.add(copy);
        copies.push({ id, child: copy });
      }
      result.splice(0, 0, copies);
      result.#revision = this.#revision;
      return result;
    } catch (error) {
      const errors: unknown[] = [error];
      for (const { child } of copies)
        try {
          child.dispose();
        } catch (cleanupError) {
          errors.push(cleanupError);
        }
      result.dispose();
      if (errors.length > 1)
        throw new AggregateError(errors, "Sketch copy and cleanup failed.");
      throw error;
    }
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    const retired = this.#entries;
    this.#entries = [];
    const errors: unknown[] = [];
    try {
      this.#pending?.discard();
    } catch (error) {
      errors.push(error);
    }
    for (const { child } of retired) {
      owners.delete(child);
      try {
        child.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Sketch child cleanup failed.");
  }
}
