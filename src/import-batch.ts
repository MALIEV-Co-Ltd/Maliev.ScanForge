/** Shared GUI/MCP queue: at most one import worker and one rendered result at a time. */
export async function importBatch<T, R>(
  files: readonly T[],
  load: (file: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<{
  completed: R[];
  failed: { index: number; error: string }[];
  cancelled: boolean;
}> {
  const completed: R[] = [],
    failed: { index: number; error: string }[] = [];
  for (let index = 0; index < files.length; index++) {
    if (signal?.aborted) return { completed, failed, cancelled: true };
    try {
      completed.push(await load(files[index], index));
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      )
        return { completed, failed, cancelled: true };
      failed.push({
        index,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { completed, failed, cancelled: false };
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
