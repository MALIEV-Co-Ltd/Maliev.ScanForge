import { encodeProjectFileLocally } from "./project-file";
import {
  restoreEncodingSnapshot,
  type ProjectEncodingSnapshot,
} from "./project-encoding-snapshot";

self.onmessage = async ({ data }: MessageEvent<ProjectEncodingSnapshot>) => {
  try {
    self.postMessage({
      file: await encodeProjectFileLocally(restoreEncodingSnapshot(data)),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
