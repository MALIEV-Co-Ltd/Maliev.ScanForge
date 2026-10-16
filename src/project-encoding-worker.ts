import {
  unpackProjectTransport,
  type ProjectTransport,
} from "./project-transport";
import { encodeProjectFileLocally } from "./project-file-codec";
import {
  restoreEncodingSnapshot,
  type ProjectEncodingSnapshot,
} from "./project-encoding-snapshot";

self.onmessage = async ({
  data,
}: MessageEvent<ProjectEncodingSnapshot | ProjectTransport>) => {
  try {
    const snapshot =
      "kind" in data
        ? await unpackProjectTransport<ProjectEncodingSnapshot>(data, {
            cooperative: false,
          })
        : data;
    self.postMessage({
      file: await encodeProjectFileLocally(restoreEncodingSnapshot(snapshot)),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
