import {
  createGlobalQueryWorkerState,
  type GlobalQueryRequest,
  type GlobalQueryResponse,
} from "./scan-global-query-core";
export * from "./scan-global-query-core";
const scope = globalThis as unknown as {
  postMessage(data: GlobalQueryResponse): void;
  close(): void;
  onmessage: ((event: MessageEvent<GlobalQueryRequest>) => void) | null;
};
if (
  typeof scope.postMessage === "function" &&
  typeof document === "undefined"
) {
  let state: ReturnType<typeof createGlobalQueryWorkerState> | undefined;
  let idle: ReturnType<typeof setTimeout>;
  const lease = setTimeout(() => scope.close(), 15 * 60_000);
  const renew = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      clearTimeout(lease);
      scope.close();
    }, 30_000);
  };
  renew();
  scope.onmessage = ({ data }) => {
    renew();
    try {
      if ("initialize" in data) {
        state = createGlobalQueryWorkerState(data.initialize);
        scope.postMessage({
          id: data.id,
          ready: true,
          indexes: state.indexes,
          prepared: state.prepared,
          storage: state.storage,
        });
      } else {
        if (!state) throw new Error("Global query worker is not initialized.");
        scope.postMessage({ id: data.id, result: state.execute(data.job) });
      }
    } catch (error) {
      scope.postMessage({
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      renew();
    }
  };
}
