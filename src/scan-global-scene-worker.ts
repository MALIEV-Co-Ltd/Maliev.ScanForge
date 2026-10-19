import {
  executeGlobalScenePreparation,
  type GlobalSceneInput,
  type GlobalSceneResponse,
} from "./scan-global-scene-core";
export * from "./scan-global-scene-core";
const scope = globalThis as unknown as {
  postMessage(data: GlobalSceneResponse, transfer?: Transferable[]): void;
  close(): void;
  onmessage: ((event: MessageEvent<GlobalSceneInput>) => void) | null;
};
if (
  typeof scope.postMessage === "function" &&
  typeof document === "undefined"
) {
  const lease = setTimeout(() => scope.close(), 120_000);
  scope.onmessage = ({ data }) => {
    try {
      const result = executeGlobalScenePreparation(data);
      scope.postMessage(
        { result },
        result.sources.flatMap(
          (source) =>
            [source.labels.buffer, source.spatialFlags.buffer] as ArrayBuffer[],
        ),
      );
    } catch (error) {
      scope.postMessage({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(lease);
      scope.close();
    }
  };
}
