import type { ProjectTransport } from "./project-transport";
import { unpackProjectEncodingTransport } from "./project-encoding-numeric";
import { encodeProjectFileLocally } from "./project-file-codec";
import {
  validateEncodingChunkSources,
  type ProjectEncodingChunkToken,
} from "./project-encoding-chunks";
import {
  restoreEncodingSnapshot,
  type ProjectEncodingSnapshot,
} from "./project-encoding-snapshot";

self.onmessage = async ({
  data,
}: MessageEvent<
  (ProjectEncodingSnapshot | ProjectTransport) & {
    sharedChunkSources?: unknown;
  }
>) => {
  try {
    const sources = validateEncodingChunkSources(data.sharedChunkSources);
    const snapshot =
      "kind" in data ? await unpackProjectEncodingTransport(data) : data;
    const sharedChunkTokens: ProjectEncodingChunkToken[] = [];
    const seen = new Set<number>();
    const file = await encodeProjectFileLocally(
      restoreEncodingSnapshot(snapshot),
      {
        onSharedChunk: (chunk) => {
          const sourceToken = sources.indexOf(chunk.buffer);
          if (sourceToken >= 0 && !seen.has(sourceToken)) {
            seen.add(sourceToken);
            sharedChunkTokens.push({ sourceToken, sha256: chunk.sha256 });
          }
        },
      },
    );
    self.postMessage({ file, sharedChunkTokens });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
