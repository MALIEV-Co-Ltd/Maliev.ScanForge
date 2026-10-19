import {
  ownedWorkerCleanupPending,
  retryOwnedWorkerStops,
  type WorkerCleanupOutcome,
} from "./scan-global-worker-cleanup";
import { runGlobalScanController } from "./scan-global-controller-core";
import {
  capabilities,
  CONTROL_BYTES,
  COORDINATOR_RESERVE_BYTES,
  CONTROLLER_LEASE_MS,
  createControllerBridge,
  sharedControllerPacket,
  assertControllerResult,
  assertControllerStates,
  preparedMetadataReserve,
  type Start,
  type WorkerReply,
} from "./scan-global-controller-protocol";

const scope = globalThis as unknown as {
  document?: unknown;
  postMessage(data: WorkerReply): void;
  close(): void;
  onmessage:
    | ((
        event: MessageEvent<
          Start | { kind: "abort" | "retry-cleanup"; runId: number }
        >,
      ) => void)
    | null;
};
if (
  typeof scope.postMessage === "function" &&
  typeof scope.document === "undefined"
) {
  let active = false,
    runId = 0;
  let abort: AbortController | undefined;
  let workerLease: ReturnType<typeof setTimeout> | undefined;
  let startup: ReturnType<typeof setTimeout> | undefined = setTimeout(
    () => scope.close(),
    30_000,
  );
  scope.postMessage({ kind: "ready", capability: capabilities() });
  scope.onmessage = ({ data }) => {
    if (data?.kind === "retry-cleanup") {
      if (data.runId === runId) {
        const unresolved = retryOwnedWorkerStops().length;
        scope.postMessage({ kind: "cleanup", runId, unresolved });
        if (!unresolved) {
          clearTimeout(workerLease);
          scope.onmessage = null;
          scope.close();
        }
      }
      return;
    }
    if (data?.kind === "abort") {
      if (data.runId === runId) abort?.abort();
      return;
    }
    if (active || data?.kind !== "start") return;
    active = true;
    runId = data.runId;
    clearTimeout(startup);
    startup = undefined;
    void (async () => {
      let childCleanup: WorkerCleanupOutcome[] = [];
      let childrenCloseRequested = false;
      try {
        if (
          !Number.isSafeInteger(runId) ||
          runId < 1 ||
          !(data.control instanceof SharedArrayBuffer) ||
          data.control.byteLength !== CONTROL_BYTES ||
          data.metadataReservedBytes !==
            preparedMetadataReserve(data.preparedScene) ||
          !Number.isSafeInteger(data.externalReservedBytes) ||
          data.externalReservedBytes < 0 ||
          data.externalReservedBytes > 512 * 1048576 ||
          ![1, 2].includes(data.expectedWorkers) ||
          !sharedControllerPacket(data.input) ||
          !sharedControllerPacket(data.routedInput)
        )
          throw Error("Invalid admitted shared controller initialization.");
        const words = new Int32Array(data.control);
        abort = new AbortController();
        workerLease = setTimeout(() => {
          abort?.abort();
          scope.close();
        }, CONTROLLER_LEASE_MS);
        const base = abort.signal;
        const signal = new Proxy(base, {
          get(target, key) {
            // Shared cancellation remains observable during native loops/Atomics.wait.
            if (key === "aborted")
              return target.aborted || Atomics.load(words, 2) !== 0;
            if (key === "throwIfAborted")
              return () => {
                target.throwIfAborted();
                if (Atomics.load(words, 2))
                  throw new DOMException(
                    "Global alignment cancelled.",
                    "AbortError",
                  );
              };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const ids = new Map(
          data.input.scans.map((scan) => [
            scan.id,
            scan.geometry.points.length / 3,
          ]),
        );
        const rpc = createControllerBridge(data.control, runId, (request) => {
          if (request.action === "pass")
            assertControllerStates(request.ordered, ids);
          scope.postMessage(request);
        });
        const result = await runGlobalScanController(
          data.input,
          data.routedInput,
          {
            parallel: data.parallel,
            localTolerance: data.localTolerance,
            coverageTolerance: data.coverageTolerance,
            signal,
            check: () => {
              rpc({ action: "check" });
            },
            clock: () => rpc({ action: "clock" }),
            onPass: (pass, ordered) => {
              rpc({ action: "pass", pass, ordered });
            },
            onProgress: (fraction, stage) => {
              rpc({ action: "progress", fraction, stage });
            },
            runtimeReserveBytes:
              COORDINATOR_RESERVE_BYTES + data.metadataReservedBytes,
            externalReservedBytes: data.externalReservedBytes,
            expectedWorkers: data.expectedWorkers,
            onQueryPoolCleanup: (outcomes) => {
              childCleanup = outcomes;
            },
            onControllerClosed: () => {
              childrenCloseRequested = true;
            },
          },
          data.mode,
          data.radius,
          data.preparedScene,
        );
        assertControllerResult(result, ids);
        scope.postMessage({
          kind: "result",
          runId,
          result,
          childrenCloseRequested: true,
        });
      } catch (error) {
        scope.postMessage({
          kind: "failed",
          runId,
          error: String(error instanceof Error ? error.message : error).slice(
            0,
            240,
          ),
          childrenCloseRequested,
          childCleanup,
        });
      } finally {
        abort = undefined;
        if (!ownedWorkerCleanupPending().length) {
          clearTimeout(workerLease);
          scope.onmessage = null;
          scope.close();
        }
        // Unconfirmed child handles remain in this finite-lived coordinator realm for exact retry.
      }
    })();
  };
}
