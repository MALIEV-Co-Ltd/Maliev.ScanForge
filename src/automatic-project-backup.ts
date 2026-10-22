import { writeBackup } from "./project-backup";
import { encodeProjectFile, type ProjectSession } from "./project-file";
import {
  beginPriorityScanPreparation,
  priorityScanPreparationCount,
  watchPriorityScanPreparation,
} from "./scan-background-preparation";

/** False postpones this interval without replacing the last successful backup. */
export async function writeAutomaticProjectBackup(
  id: string,
  snapshot: ProjectSession,
  allowed: () => boolean,
  captureThumbnail?: () => Promise<Blob | null>,
  signal?: AbortSignal,
): Promise<void | false> {
  if (!allowed() || signal?.aborted || priorityScanPreparationCount())
    return false;
  const controller = new AbortController();
  let abandon!: (value: null) => void;
  const cancelled = new Promise<null>((resolve) => {
    abandon = resolve;
  });
  const cancel = () => {
    controller.abort();
    abandon(null);
  };
  // Own the first lease; any additional import or picking lease preempts us.
  const unsubscribe = watchPriorityScanPreparation(() => {
    if (priorityScanPreparationCount() > 1) cancel();
  });
  signal?.addEventListener("abort", cancel, { once: true });
  const release = beginPriorityScanPreparation();
  const permitted = () => allowed() && !controller.signal.aborted;
  let thumbnailTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const thumbnail = await Promise.race([
      Promise.resolve()
        .then(() => (permitted() ? captureThumbnail?.() : null))
        .catch(() => null),
      cancelled,
      new Promise<null>((resolve) => {
        thumbnailTimer = setTimeout(() => resolve(null), 5_000);
      }),
    ]);
    clearTimeout(thumbnailTimer);
    if (!permitted()) return false;
    const file = await Promise.race([
      encodeProjectFile(snapshot, controller.signal),
      cancelled,
    ]);
    if (!file || !permitted()) return false;
    await writeBackup({
      id,
      name: snapshot.project.name,
      savedAt: Date.now(),
      file,
      ...(thumbnail ? { thumbnail } : {}),
    });
  } catch (error) {
    if (
      controller.signal.aborted &&
      error instanceof Error &&
      error.name === "AbortError"
    )
      return false;
    throw error;
  } finally {
    clearTimeout(thumbnailTimer);
    unsubscribe();
    signal?.removeEventListener("abort", cancel);
    release();
  }
}
