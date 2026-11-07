import { exportStl } from "./io";
import { markPrivateDecodingView } from "./project-private-decoding-views";
import type { Entity } from "./types";

self.onmessage = ({
  data,
}: MessageEvent<{
  entities: (Entity & { privateIndexedVertices?: boolean })[];
}>) => {
  try {
    for (const entity of data.entities) {
      const vertices = entity.indexedMesh?.vertices;
      if (entity.privateIndexedVertices && vertices instanceof Float64Array)
        markPrivateDecodingView(vertices);
    }
    self.postMessage({ started: true });
    const result = exportStl(data.entities);
    const buffer =
      result.buffer instanceof ArrayBuffer &&
      result.byteOffset === 0 &&
      result.byteLength === result.buffer.byteLength
        ? result.buffer
        : new Uint8Array(
            result.buffer,
            result.byteOffset,
            result.byteLength,
          ).slice().buffer;
    self.postMessage({ buffer }, { transfer: [buffer] });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
