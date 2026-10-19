import {
  assertNoUnresolvedOwnedWorkers,
  requestOwnedWorkerStop,
  retainNestedControllerCleanup,
} from "./scan-global-worker-cleanup";
import type { GlobalSceneInput } from "./scan-global-scene-core";
import type { GlobalRegistrationOptions } from "./scan-global-registration";
import {
  runGlobalScanController,
  type GlobalControllerResult,
} from "./scan-global-controller-core";
import {
  prepareGlobalScene,
  preparedGlobalQueryScans,
  type PreparedGlobalQueryScene,
} from "./scan-global-scene-client";
import {
  globalCoordinatorQueryAdmission,
  globalQueryPoolAdmission,
} from "./scan-global-query-pool";
import {
  globalQueryExternalInputBytes,
  shareGlobalQueryInput,
} from "./scan-global-query-storage";
import {
  CONTROL_BYTES,
  COORDINATOR_RESERVE_BYTES,
  CONTROLLER_LEASE_MS,
  RPC_TIMEOUT_MS,
  MAX_RPC,
  acknowledgeController,
  cancelController,
  capabilities,
  sameCapabilities,
  assertControllerResult,
  assertControllerStates,
  assertChildCleanup,
  sharedControllerPacket,
  preparedMetadataReserve,
  type Start,
  type WorkerReply,
  type Rpc,
} from "./scan-global-controller-protocol";

let nextRun = 0;
/** Unsupported/unadmitted packets preserve the exact original direct controller. */
export async function runSharedGlobalController(
  input: GlobalSceneInput,
  routedInput: GlobalSceneInput,
  options: GlobalRegistrationOptions,
  mode: "target-average" | "pooled-plane",
  radius: number,
): Promise<GlobalControllerResult | undefined> {
  if (options.signal?.aborted) return Promise.reject(options.signal.reason);
  assertNoUnresolvedOwnedWorkers();
  if (
    options.controllerIsolation === false ||
    typeof Worker === "undefined" ||
    globalThis.crossOriginIsolated !== true ||
    typeof SharedArrayBuffer === "undefined" ||
    !sharedControllerPacket(input, false) ||
    !sharedControllerPacket(routedInput, false)
  )
    return;
  // Preserve the original scoped scene admission/worker and consume clocks once.
  // No coordinator or shared geometry copy exists during this preparation phase.
  let scene: PreparedGlobalQueryScene | undefined = ((prepared) => ({
    sources: prepared.sources
      .filter((source) => source.eligible)
      .map((source) => ({
        id: source.id,
        eligible: true,
        labels: source.labels,
        selected: source.selected,
        sampled: source.sampled,
      })),
  }))(await prepareGlobalScene(routedInput, options.signal));
  let queryInput: ReturnType<typeof preparedGlobalQueryScans> | undefined =
    preparedGlobalQueryScans(routedInput, scene);
  let transportScene: PreparedGlobalQueryScene | undefined = {
    sources: scene.sources
      .filter((source) => source.eligible)
      .map((source) => ({
        id: source.id,
        eligible: true,
        labels: source.labels,
        selected: source.selected,
        sampled: source.sampled,
      })),
  };
  // Count full parent ordinary backing union, including excluded scans and the
  // newly prepared labels. Those private originals remain conservatively charged.
  const externalReservedBytes = globalQueryExternalInputBytes({
    scans: [...routedInput.scans, ...queryInput.scans],
  });
  const queryOrdinaryBytes = globalQueryExternalInputBytes(queryInput);
  let expectedWorkers: number, metadataReservedBytes: number;
  try {
    metadataReservedBytes = preparedMetadataReserve(transportScene);
    const originalWorkers = globalQueryPoolAdmission(
      queryInput,
      options.parallel,
    );
    expectedWorkers = globalCoordinatorQueryAdmission(
      queryInput,
      options.parallel,
      COORDINATOR_RESERVE_BYTES +
        metadataReservedBytes +
        externalReservedBytes -
        queryOrdinaryBytes,
      0,
      originalWorkers,
    );
  } catch {
    // Exact prepared result is reused; never redo scene preparation or its clocks.
    return runGlobalScanController(
      input,
      routedInput,
      options,
      mode,
      radius,
      scene,
    );
  }
  const parentCapability = capabilities();
  const ids = new Map(
    queryInput.scans.map((scan) => [scan.id, scan.geometry.points.length / 3]),
  );
  let pending:
    | {
        input: GlobalSceneInput;
        routedInput: GlobalSceneInput;
        scene: PreparedGlobalQueryScene;
        queryInput: ReturnType<typeof preparedGlobalQueryScans>;
        transportScene: PreparedGlobalQueryScene;
      }
    | undefined = {
    input,
    routedInput,
    scene,
    queryInput,
    transportScene,
  };
  scene = undefined;
  queryInput = undefined;
  transportScene = undefined;
  let packet: Start | undefined;
  let control: SharedArrayBuffer | undefined;
  const runId = ++nextRun,
    createdUnixMs = Date.now();
  input = undefined as unknown as GlobalSceneInput;
  routedInput = undefined as unknown as GlobalSceneInput;
  const isolated = await new Promise<GlobalControllerResult | undefined>(
    (resolve, reject) => {
      let worker: Worker | undefined,
        started = false,
        ready = false,
        finished = false,
        lastRpc = 0;
      let hasFailure = false,
        failure: unknown;
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      let startupTimer: ReturnType<typeof setTimeout> | undefined;
      let lease: ReturnType<typeof setTimeout> | undefined;
      const finish = (outcome: {
        result?: GlobalControllerResult;
        error?: unknown;
        fallback?: boolean;
        retainNested?: boolean;
      }) => {
        if (finished) return;
        finished = true;
        clearTimeout(cleanupTimer);
        clearTimeout(startupTimer);
        clearTimeout(lease);
        options.signal?.removeEventListener("abort", abort);
        let terminationError: unknown;
        if (worker) {
          const identity = {
            owner: "controller:" + runId,
            runId,
            target: "scan-global-controller-worker.ts",
            createdUnixMs,
            expiresUnixMs: createdUnixMs + CONTROLLER_LEASE_MS,
          };
          if (outcome.retainNested)
            retainNestedControllerCleanup(worker, identity, control);
          else {
            const cleanup = requestOwnedWorkerStop(worker, identity, control);
            if (cleanup.retained)
              terminationError = Error(
                "Controller termination request remains unconfirmed; exact recovery handle retained.",
              );
          }
        }
        worker = undefined;
        if (!outcome.fallback) pending = undefined;
        packet = undefined;
        control = undefined;
        ids.clear();
        if ("error" in outcome) reject(outcome.error);
        else if (terminationError !== undefined) reject(terminationError);
        else resolve(outcome.result);
      };
      const fail = (error: unknown) => {
        if (finished) return;
        if (!hasFailure) {
          hasFailure = true;
          failure = error;
        }
        if (control) cancelController(control);
        if (!started) {
          finish({ error: failure });
          return;
        }
        try {
          worker?.postMessage({ kind: "abort", runId });
        } catch {
          /* Preserve original failure. */
        }
        cleanupTimer ??= setTimeout(
          () => finish({ error: failure }),
          RPC_TIMEOUT_MS,
        );
      };
      const abort = () =>
        fail(
          options.signal?.reason ??
            new DOMException("Global alignment cancelled.", "AbortError"),
        );
      const rpc = (data: Rpc) => {
        const names = [
          "kind",
          "runId",
          "requestId",
          "action",
          ...(data.action === "pass"
            ? ["pass", "ordered"]
            : data.action === "progress"
              ? ["fraction", "stage"]
              : []),
        ];
        if (
          Object.keys(data).length !== names.length ||
          Object.keys(data).some((key) => !names.includes(key))
        )
          throw Error("Unexpected controller callback fields.");
        if (
          !control ||
          data.requestId !== lastRpc + 1 ||
          data.requestId > MAX_RPC
        )
          throw Error("Duplicate/out-of-order controller callback.");
        lastRpc = data.requestId;
        let seed = 0;
        try {
          if (hasFailure) throw failure;
          switch (data.action) {
            case "check":
              options.signal?.throwIfAborted();
              options.check?.();
              break;
            case "clock":
              // Original native clock expression calls this once, after pool readiness.
              seed = (
                options.clock ?? (() => Math.trunc(performance.now()) | 0)
              )();
              break;
            case "pass":
              if (
                !Number.isInteger(data.pass) ||
                data.pass! < 0 ||
                data.pass! > 19
              )
                throw Error("Invalid controller pass.");
              assertControllerStates(data.ordered, ids);
              options.onPass?.(data.pass!, data.ordered!);
              break;
            case "progress":
              if (
                !Number.isFinite(data.fraction) ||
                data.fraction! < 0 ||
                data.fraction! > 1 ||
                typeof data.stage !== "string" ||
                data.stage.length > 160
              )
                throw Error("Invalid controller progress.");
              options.onProgress?.(data.fraction!, data.stage);
              break;
            default:
              throw Error("Invalid controller callback action.");
          }
          acknowledgeController(control, data.requestId, seed);
        } catch (error) {
          acknowledgeController(control, data.requestId, seed, true);
          fail(error);
        }
      };
      try {
        worker = new Worker(
          new URL("./scan-global-controller-worker.ts", import.meta.url),
          { type: "module", name: "global-alignment-controller" },
        );
        worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
          if (finished) return;
          try {
            if (!data || typeof data !== "object")
              throw Error("Invalid controller response.");
            if (data.kind === "ready") {
              if (ready) throw Error("Duplicate controller readiness.");
              ready = true;
              clearTimeout(startupTimer);
              if (!sameCapabilities(parentCapability, data.capability)) {
                finish({ fallback: true });
                return;
              }
              if (hasFailure || options.signal?.aborted) {
                abort();
                return;
              }
              if (!pending) throw Error("Missing controller input descriptor.");
              // Readiness/capability match happens before any large shared copy.
              const shared = shareGlobalQueryInput(pending.queryInput);
              const labels = new Map(
                shared.scans.map((scan) => [scan.id, scan.geometry.labels!]),
              );
              // The old outer controller filters original input order, whereas the
              // query pool follows prepared source order. Preserve both explicitly.
              const sharedById = new Map(
                shared.scans.map((scan) => [scan.id, scan]),
              );
              const controllerScans = pending.input.scans
                .filter((scan) => sharedById.has(scan.id))
                .map((scan) => sharedById.get(scan.id)!);
              const preparedScene: PreparedGlobalQueryScene = {
                sources: pending.transportScene.sources.map((source) => ({
                  id: source.id,
                  eligible: true,
                  labels: labels.get(source.id)!,
                  selected: source.selected,
                  sampled: source.sampled,
                })),
              };
              control = new SharedArrayBuffer(CONTROL_BYTES);
              packet = {
                kind: "start",
                runId,
                control,
                input: {
                  scans: controllerScans,
                  spacing: pending.input.spacing,
                  radius: pending.input.radius,
                  budget: pending.input.budget,
                  mask: pending.input.mask,
                },
                routedInput: {
                  scans: shared.scans,
                  spacing: pending.routedInput.spacing,
                  radius: pending.routedInput.radius,
                  budget: pending.routedInput.budget,
                  mask: pending.routedInput.mask,
                },
                parallel: options.parallel,
                localTolerance: options.localTolerance,
                coverageTolerance: options.coverageTolerance,
                externalReservedBytes,
                expectedWorkers,
                metadataReservedBytes,
                preparedScene,
                mode,
                radius,
              };
              started = true;
              worker!.postMessage(packet);
              packet = undefined;
              pending = undefined;
              return;
            }
            if (data.runId !== runId) return;
            if (!started)
              throw Error("Controller replied before initialization.");
            if (data.kind === "rpc") {
              rpc(data);
              return;
            }
            if (data.kind === "failed") {
              if (
                Object.keys(data).length !== 5 ||
                Object.keys(data).some(
                  (key) =>
                    ![
                      "kind",
                      "runId",
                      "error",
                      "childrenCloseRequested",
                      "childCleanup",
                    ].includes(key),
                )
              )
                throw Error("Unexpected controller failure fields.");
              if (
                typeof data.error !== "string" ||
                data.error.length > 240 ||
                typeof data.childrenCloseRequested !== "boolean"
              )
                throw Error("Invalid controller failure response.");
              assertChildCleanup(data.childCleanup);
              const unresolved = data.childCleanup.some(
                (outcome) => outcome.retained,
              );
              if (unresolved) {
                finish({
                  error: hasFailure ? failure : Error(data.error),
                  retainNested: true,
                });
                return;
              }
              finish({ error: hasFailure ? failure : Error(data.error) });
              return;
            }
            if (data.kind !== "result" || data.childrenCloseRequested !== true)
              throw Error("Missing controller cleanup/result barrier.");
            if (
              Object.keys(data).length !== 4 ||
              Object.keys(data).some(
                (key) =>
                  ![
                    "kind",
                    "runId",
                    "result",
                    "childrenCloseRequested",
                  ].includes(key),
              )
            )
              throw Error("Unexpected controller result fields.");
            if (hasFailure) {
              finish({ error: failure });
              return;
            }
            assertControllerResult(data.result, ids);
            finish({ result: data.result });
          } catch (error) {
            fail(error);
          }
        };
        worker.onerror = (event) =>
          fail(Error(event.message || "Global controller worker failed."));
        worker.onmessageerror = () =>
          fail(
            Error("Global controller worker response could not be decoded."),
          );
        startupTimer = setTimeout(
          () => fail(Error("Global controller startup timed out.")),
          RPC_TIMEOUT_MS,
        );
        lease = setTimeout(
          () => fail(Error("Global controller lease expired.")),
          CONTROLLER_LEASE_MS,
        );
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
      } catch (error) {
        fail(error);
      }
    },
  );
  if (isolated !== undefined) return isolated;
  const direct = pending;
  pending = undefined;
  if (!direct) throw Error("Missing prepared direct fallback.");
  return runGlobalScanController(
    direct.input,
    direct.routedInput,
    options,
    mode,
    radius,
    direct.scene,
  );
}
