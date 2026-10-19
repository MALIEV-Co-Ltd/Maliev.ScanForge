import {
  executeGlobalAlignmentInputPreparation,
  type GlobalAlignmentPreparationPacket,
  type GlobalAlignmentPreparationResponse,
} from "./global-alignment-input-core";
export * from "./global-alignment-input-core";
const scope = globalThis as unknown as {
  postMessage(
    data: GlobalAlignmentPreparationResponse,
    transfers?: Transferable[],
  ): void;
  close(): void;
  onmessage:
    ((event: MessageEvent<GlobalAlignmentPreparationPacket>) => void) | null;
};
if (
  typeof scope.postMessage === "function" &&
  typeof document === "undefined"
) {
  const lease = setTimeout(() => scope.close(), 120_000);
  scope.onmessage = ({ data }) => {
    try {
      const result = executeGlobalAlignmentInputPreparation(data);
      scope.postMessage({ result }, [
        result.vertices.buffer,
        result.triangles.buffer,
        result.normals.buffer,
      ]);
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
