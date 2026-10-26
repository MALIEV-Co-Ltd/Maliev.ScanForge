export type ImportBatchProgress = {
  kind: "importBatch";
  files: {
    index: number;
    name: string;
    status:
      | "queued"
      | "importing"
      | "rendering"
      | "complete"
      | "failed"
      | "cancelled";
    fraction: number;
    stage: string;
  }[];
};

/** Conservative admission; file bytes underestimate decoded geometry and render buffers. */
export function importConcurrency(
  files: readonly { size: number }[],
  capacity = {
    cores: globalThis.navigator?.hardwareConcurrency ?? 4,
    memoryGiB:
      (globalThis.navigator as Navigator & { deviceMemory?: number })
        ?.deviceMemory ?? 8,
  },
): number {
  const memory = (
    globalThis.performance as Performance & {
      memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number };
    }
  )?.memory;
  // Reserve another third for retained computed facet vectors (12 bytes/face
  // beside the 36-byte expanded triangle stream). This remains a concurrency
  // heuristic, not an acceptance limit or a whole-process memory guarantee.
  const estimate = files.reduce((sum, file) => sum + file.size, 0) * 16;
  return files.length > 1 &&
    capacity.cores > 2 &&
    capacity.memoryGiB > 4 &&
    files.every((file) => file.size <= 64 * 1024 * 1024) &&
    estimate <= 512 * 1024 * 1024 &&
    (!memory ||
      memory.jsHeapSizeLimit - memory.usedJSHeapSize >
        estimate + 256 * 1024 * 1024)
    ? 2
    : 1;
}

/** Bounded preparation with serialized publication; a slot retains at most one result. */
export async function importBatch<T, R, C = R>(
  files: readonly T[],
  load: (
    file: T,
    index: number,
    context: {
      signal: AbortSignal;
      progress(fraction: number, stage: string): void;
    },
  ) => Promise<R>,
  signal?: AbortSignal,
  options: {
    concurrency?: number;
    names?: readonly string[];
    commit?: (value: R, file: T, index: number) => Promise<C>;
    onProgress?: (progress: ImportBatchProgress) => void;
  } = {},
): Promise<{
  completed: C[];
  failed: { index: number; error: string }[];
  cancelled: boolean;
}> {
  const completed = new Map<number, C>(),
    failed: { index: number; error: string }[] = [];
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const states: ImportBatchProgress["files"] = files.map((_, index) => ({
    index,
    name: options.names?.[index] ?? String(index + 1),
    status: "queued",
    fraction: 0,
    stage: "Queued",
  }));
  const publish = () =>
    options.onProgress?.({
      kind: "importBatch",
      files: states.map((state) => ({ ...state })),
    });
  let next = 0;
  let publication = Promise.resolve();
  const work = async () => {
    while (!controller.signal.aborted && next < files.length) {
      const index = next++,
        state = states[index];
      state.status = "importing";
      state.stage = "Importing";
      publish();
      try {
        const value = await load(files[index], index, {
          signal: controller.signal,
          progress(fraction, stage) {
            if (controller.signal.aborted) return;
            state.fraction = Number.isFinite(fraction)
              ? Math.max(0, Math.min(1, fraction))
              : state.fraction;
            state.stage = stage;
            publish();
          },
        });
        const commit = publication.then(async () => {
          controller.signal.throwIfAborted();
          state.status = "rendering";
          state.stage = "Rendering";
          publish();
          const result = options.commit
            ? await options.commit(value, files[index], index)
            : (value as unknown as C);
          completed.set(index, result);
          state.status = "complete";
          state.fraction = 1;
          state.stage = "Complete";
          publish();
        });
        publication = commit.catch(() => {});
        await commit;
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          controller.abort();
          state.status = "cancelled";
          state.stage = "Cancelled";
        } else {
          state.status = "failed";
          state.stage = error instanceof Error ? error.message : String(error);
          failed.push({ index, error: state.stage });
        }
        publish();
      }
    }
  };
  try {
    publish();
    const concurrency = options.concurrency === 2 ? 2 : 1;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, files.length) }, work),
    );
    if (controller.signal.aborted)
      for (const state of states)
        if (state.status === "queued") {
          state.status = "cancelled";
          state.stage = "Cancelled";
        }
    publish();
    return {
      completed: [...completed]
        .sort(([a], [b]) => a - b)
        .map(([, value]) => value),
      failed: failed.sort((a, b) => a.index - b.index),
      cancelled: controller.signal.aborted,
    };
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

/** A project replaces a workspace, so it must never silently erase a scan batch. */
export function validateImportBatch(names: readonly string[]): void {
  if (!names.length) throw new Error("Choose at least one file.");
  for (const name of names) {
    if (
      !/\.(stl|obj|ply|asc|step|stp|iges|igs|brep|scanforge|json)$/i.test(name)
    )
      throw new Error(`Unsupported import file: ${name}`);
    if (names.length > 1 && /\.(scanforge|json)$/i.test(name))
      throw new Error("Open project files separately from scan batches.");
  }
}
