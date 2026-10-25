import {
  decodeProjectContents,
  type ProjectSharedChunk,
} from "./project-file-codec";
import { projectEncodingSnapshot } from "./project-encoding-snapshot";
import { prepareRestoredScanDisplays } from "./restored-scan-display";
import { scanRenderData } from "./scan-render-data";
import { packProjectTransport } from "./project-transport";
import { assertReferenceWorkspaceAdmission } from "./reference-entity";
const scope = self as unknown as {
  onmessage:
    | ((
        e: MessageEvent<{ file: Blob; reusableChunks?: ProjectSharedChunk[] }>,
      ) => void)
    | null;
  postMessage: (value: unknown, transfer?: Transferable[]) => void;
  close: () => void;
};
const lease = setTimeout(() => scope.close(), 120000);
scope.onmessage = async ({ data }) => {
  try {
    const sharedChunks: ProjectSharedChunk[] = [];
    const session = await decodeProjectContents(data.file, {
      sharedReadonlyBuffers: true,
      reusableChunks: data.reusableChunks,
      onSharedChunk: (chunk) => sharedChunks.push(chunk),
    });
    assertReferenceWorkspaceAdmission(session);
    session.project.entities = prepareRestoredScanDisplays(
      session.project.entities,
    );
    const seen = new Set();
    const displays = session.project.entities.flatMap((e) => {
      const result = scanRenderData(e.positions);
      if (!result || seen.has(e.positions)) return [];
      seen.add(e.positions);
      return [{ positions: e.positions, data: result }];
    });
    const encoded = await packProjectTransport(
      { snapshot: projectEncodingSnapshot(session), displays, sharedChunks },
      { ownedTypedArrays: true, cooperative: false },
    );
    scope.postMessage({ packet: encoded.packet }, encoded.transfers);
  } catch (error) {
    scope.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(lease);
    scope.close();
  }
};
