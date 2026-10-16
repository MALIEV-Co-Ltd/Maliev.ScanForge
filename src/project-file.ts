import {
  encodeProjectFileLocally,
  decodeProjectContents,
  type ProjectSession,
} from "./project-file-codec";
import { encodeProjectInBackground } from "./project-encoding-client";
import { decodeProjectInBackground } from "./project-decoding-client";
import { prepareRestoredScanDisplays } from "./restored-scan-display";
export {
  encodeProjectFileLocally,
  decodeProjectContents,
} from "./project-file-codec";
export type { ProjectSession } from "./project-file-codec";
export async function encodeProjectFile(
  session: ProjectSession,
  signal?: AbortSignal,
): Promise<Blob> {
  if (signal?.aborted)
    throw new DOMException("Project encoding cancelled.", "AbortError");
  return typeof document !== "undefined" && typeof Worker !== "undefined"
    ? encodeProjectInBackground(session, signal)
    : encodeProjectFileLocally(session);
}

export async function decodeProjectFile(
  file: Blob,
  signal?: AbortSignal,
): Promise<ProjectSession> {
  signal?.throwIfAborted();
  if (typeof document !== "undefined")
    return decodeProjectInBackground(file, signal);
  const session = await decodeProjectContents(file);
  signal?.throwIfAborted();
  await prepareRestoredScanDisplays(session.project.entities, signal);
  signal?.throwIfAborted();
  return session;
}
