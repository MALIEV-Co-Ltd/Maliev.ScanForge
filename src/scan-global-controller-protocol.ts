import type { WorkerCleanupOutcome } from "./scan-global-worker-cleanup";
import type { PreparedGlobalQueryScene } from "./scan-global-scene-client";
import type { GlobalSceneInput } from "./scan-global-scene-core";
import type { GlobalControllerResult } from "./scan-global-controller-core";
import type { GlobalOuterState } from "./scan-native-global-outer";

export const CONTROL_BYTES = 32;
export const COORDINATOR_RESERVE_BYTES = 16 * 1048576 + CONTROL_BYTES;
export const CONTROLLER_LEASE_MS = 15 * 60_000;
export const RPC_TIMEOUT_MS = 30_000;
export const MAX_RPC = 131072;
export type Capability = {
  isolated: boolean;
  workers: boolean;
  hardware: number;
  memory?: number;
};
export const capabilities = (): Capability => ({
  isolated: globalThis.crossOriginIsolated === true,
  workers: typeof Worker !== "undefined",
  hardware: globalThis.navigator?.hardwareConcurrency ?? 2,
  memory: (globalThis.navigator as Navigator & { deviceMemory?: number })
    ?.deviceMemory,
});
export const sameCapabilities = (a: Capability, b: Capability) =>
  a.isolated === b.isolated &&
  a.workers === b.workers &&
  a.hardware === b.hardware &&
  a.memory === b.memory;
export type Rpc = {
  kind: "rpc";
  runId: number;
  requestId: number;
  action: "check" | "clock" | "pass" | "progress";
  pass?: number;
  ordered?: readonly GlobalOuterState[];
  fraction?: number;
  stage?: string;
};
export type Start = {
  kind: "start";
  runId: number;
  control: SharedArrayBuffer;
  input: GlobalSceneInput;
  routedInput: GlobalSceneInput;
  mode: "target-average" | "pooled-plane";
  radius: number;
  parallel?: boolean;
  localTolerance?: number;
  coverageTolerance?: number;
  externalReservedBytes: number;
  expectedWorkers: number;
  metadataReservedBytes: number;
  preparedScene: PreparedGlobalQueryScene;
};
export type WorkerReply =
  | { kind: "ready"; capability: Capability }
  | Rpc
  | { kind: "cleanup"; runId: number; unresolved: number }
  | {
      kind: "result";
      runId: number;
      result: GlobalControllerResult;
      childrenCloseRequested: true;
    }
  | {
      kind: "failed";
      runId: number;
      error: string;
      childrenCloseRequested: boolean;
      childCleanup: WorkerCleanupOutcome[];
    };

const fail: () => never = () => {
  throw Error("Invalid bounded controller scalar protocol.");
};
const record = (v: unknown): Record<string, unknown> => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.getPrototypeOf(v) !== Object.prototype
  )
    return fail();
  return v as Record<string, unknown>;
};
const keys = (v: Record<string, unknown>, names: string[]) => {
  if (
    Object.keys(v).length !== names.length ||
    names.some((k) => !Object.hasOwn(v, k))
  )
    fail();
};
const integer = (v: unknown, low: number, high: number): number => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < low || v > high)
    return fail();
  return v;
};
export function assertChildCleanup(
  value: unknown,
): asserts value is WorkerCleanupOutcome[] {
  if (!Array.isArray(value) || value.length > 2) fail();
  const owners = new Set<string>();
  for (const item of value) {
    const row = record(item);
    keys(row, [
      "owner",
      "runId",
      "target",
      "createdUnixMs",
      "expiresUnixMs",
      "attempts",
      "status",
      "retained",
      "errors",
    ]);
    if (
      typeof row.owner !== "string" ||
      !row.owner.startsWith("query:") ||
      row.owner.length > 128 ||
      owners.has(row.owner) ||
      typeof row.target !== "string" ||
      !/^scan-global-query-worker\.ts:[01]$/.test(row.target) ||
      typeof row.retained !== "boolean" ||
      row.status !==
        (row.retained ? "termination-unconfirmed" : "termination-requested") ||
      !Array.isArray(row.errors) ||
      row.errors.length > 3 ||
      row.errors.some(
        (error) => typeof error !== "string" || error.length > 240,
      )
    )
      fail();
    integer(row.runId, 1, Number.MAX_SAFE_INTEGER);
    integer(row.createdUnixMs, 1, Number.MAX_SAFE_INTEGER);
    integer(
      row.expiresUnixMs,
      row.createdUnixMs as number,
      Number.MAX_SAFE_INTEGER,
    );
    integer(row.attempts, 1, 3);
    owners.add(row.owner);
  }
}
const matrix = (v: unknown) => {
  if (
    !Array.isArray(v) ||
    v.length !== 12 ||
    v.some((x) => typeof x !== "number" || !Number.isFinite(x))
  )
    fail();
};
export function assertControllerStates(
  value: unknown,
  ids: ReadonlyMap<string, number>,
) {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.length > 32 ||
    value.length !== ids.size
  )
    fail();
  const seen = new Set<string>();
  for (const state of value) {
    const s = record(state);
    keys(s, [
      "id",
      "pointCount",
      "matrix",
      "mean",
      "std",
      "converged",
      "stable",
    ]);
    if (
      typeof s.id !== "string" ||
      s.id.length > 256 ||
      !ids.has(s.id) ||
      seen.has(s.id) ||
      s.pointCount !== ids.get(s.id)
    )
      fail();
    seen.add(s.id as string);
    matrix(s.matrix);
    if (
      typeof s.mean !== "number" ||
      typeof s.std !== "number" ||
      typeof s.converged !== "boolean" ||
      typeof s.stable !== "boolean"
    )
      fail();
  }
}
export function assertControllerResult(
  value: unknown,
  ids: ReadonlyMap<string, number>,
): asserts value is GlobalControllerResult {
  const result = record(value);
  keys(result, ["outer", "mode", "queries", "queryWorkers", "localResults"]);
  if (result.mode !== "target-average" && result.mode !== "pooled-plane")
    fail();
  integer(result.queries, 0, MAX_RPC);
  integer(result.queryWorkers, 0, 2);
  const outer = record(result.outer);
  keys(outer, ["passes", "order", "states", "gaugeId", "applications", "seed"]);
  integer(outer.passes, 0, 19);
  integer(outer.seed, -0x80000000, 0xffffffff);
  assertControllerStates(outer.states, ids);
  const states = outer.states as GlobalOuterState[];
  const stateIds = new Set(states.map((s) => s.id));
  if (
    !Array.isArray(outer.order) ||
    outer.order.length !== states.length ||
    new Set(outer.order).size !== states.length ||
    outer.order.some((id) => !stateIds.has(id)) ||
    (outer.gaugeId !== undefined && !stateIds.has(outer.gaugeId as string))
  )
    fail();
  if (
    !Array.isArray(outer.applications) ||
    outer.applications.length !== 2 * states.length
  )
    fail();
  outer.applications.forEach((command, index) => {
    const c = record(command);
    keys(c, ["id", "matrix"]);
    if (c.id !== (outer.order as string[])[index % states.length]) fail();
    matrix(c.matrix);
  });
  if (
    !Array.isArray(result.localResults) ||
    result.localResults.length > 19 * 32
  )
    fail();
  for (const local of result.localResults) {
    const l = record(local);
    keys(l, ["id", "pass", "status", "iterations"]);
    if (
      !stateIds.has(l.id as string) ||
      ![0, -1, -2].includes(l.status as number)
    )
      fail();
    integer(l.pass, 0, 18);
    integer(l.iterations, 0, 8);
  }
}

/** Shared borrowed views only. Unknown fields/ordinary nonempty buffers fall back. */
export function sharedControllerPacket(
  input: GlobalSceneInput,
  requireShared = true,
): GlobalSceneInput | undefined {
  if (typeof SharedArrayBuffer === "undefined") return;
  const allowed = (v: object, names: string[]) =>
    Object.keys(v).every((k) => names.includes(k));
  const carrier = (v: unknown) =>
    ArrayBuffer.isView(v) &&
    (!requireShared ||
      v.byteLength === 0 ||
      v.buffer instanceof SharedArrayBuffer);
  if (
    !allowed(input, [
      "scans",
      "spacing",
      "radius",
      "budget",
      "mask",
      "clocks",
    ]) ||
    input.scans.length < 2 ||
    input.scans.length > 32
  )
    return;
  let clockValues = 0;
  if (
    input.clocks &&
    input.clocks.some((c) => {
      clockValues += c.length;
      return (
        !Array.isArray(c) ||
        c.some((v) => typeof v !== "number") ||
        clockValues > 65536
      );
    })
  )
    return;
  let meshCount = 0;
  for (const scan of input.scans) {
    meshCount += scan.geometry.targetMeshes?.length ?? 0;
    if (meshCount > 64) return;
    if (!allowed(scan, ["id", "geometry"]) || !scan.id || scan.id.length > 256)
      return;
    const g = scan.geometry;
    if (
      !allowed(g, [
        "points",
        "normals",
        "labels",
        "flags",
        "rawTargetIds",
        "targetMeshes",
      ]) ||
      !carrier(g.points) ||
      !carrier(g.normals) ||
      [g.labels, g.flags, g.rawTargetIds].some(
        (v) => v !== undefined && !carrier(v),
      )
    )
      return;
    if (
      (g.targetMeshes?.length ?? 0) > 64 ||
      g.targetMeshes?.some(
        (m) =>
          !allowed(m, [
            "vertices",
            "triangles",
            "flags",
            "cachedBounds",
            "minimumExtent",
            "maximumDepth",
            "filterHidden",
            "compactBounds",
            "compactNormals",
            "packedNodes",
          ]) ||
          !carrier(m.vertices) ||
          !carrier(m.triangles) ||
          (m.flags !== undefined && !carrier(m.flags)) ||
          (m.cachedBounds !== undefined &&
            (!Array.isArray(m.cachedBounds) || m.cachedBounds.length !== 6)),
      )
    )
      return;
  }
  // Structured clone preserves all repeated view/backing aliases in the one packet.
  return input;
}

/** Called ONLY by the coordinator worker, never by the UI/client. */
export function createControllerBridge(
  control: SharedArrayBuffer,
  runId: number,
  post: (request: Rpc) => void,
) {
  if (control.byteLength !== CONTROL_BYTES) fail();
  const words = new Int32Array(control);
  const seed = new Float64Array(control, 16, 1);
  let requestId = 0;
  return (request: Omit<Rpc, "kind" | "runId" | "requestId">) => {
    const id = ++requestId;
    if (id > MAX_RPC) fail();
    if (Atomics.load(words, 2))
      throw new DOMException("Global alignment cancelled.", "AbortError");
    const previous = Atomics.load(words, 0);
    Atomics.store(words, 1, 0);
    post({ ...request, kind: "rpc", runId, requestId: id });
    const deadline = performance.now() + RPC_TIMEOUT_MS;
    while (Atomics.load(words, 0) !== id) {
      if (Atomics.load(words, 2))
        throw new DOMException("Global alignment cancelled.", "AbortError");
      const remaining = deadline - performance.now();
      if (
        remaining <= 0 ||
        Atomics.wait(words, 0, previous, remaining) === "timed-out"
      )
        throw Error("Controller parent acknowledgment timed out.");
    }
    if (Atomics.load(words, 2))
      throw new DOMException("Global alignment cancelled.", "AbortError");
    if (Atomics.load(words, 1) !== 1)
      throw Error("Controller parent callback failed.");
    return seed[0]; // ACK release/acquire publishes the exact F64 seed, including -0/NaN.
  };
}
export function acknowledgeController(
  control: SharedArrayBuffer,
  id: number,
  value: number,
  error = false,
) {
  const words = new Int32Array(control);
  new Float64Array(control, 16, 1)[0] = value;
  Atomics.store(words, 1, error ? 2 : 1);
  Atomics.store(words, 0, id);
  Atomics.notify(words, 0);
}
export function cancelController(control: SharedArrayBuffer) {
  const words = new Int32Array(control);
  Atomics.store(words, 2, 1);
  // Mutate the wait predicate as well: a notify before waiter registration alone
  // can be lost. Positive words[0] values remain exclusively ACK request IDs.
  Atomics.store(words, 0, -1);
  Atomics.notify(words, 0);
}

/** Explicit conservative JS metadata accounting: both parent and cloned worker copies.
 * 32 bytes per ID number (boxed slot+value allowance),64 per array,256 per source.
 * This is a guard estimate, not an exact engine heap/private-byte measurement. */
export function preparedMetadataReserve(scene: PreparedGlobalQueryScene) {
  keys(record(scene), ["sources"]);
  if (
    !scene ||
    !Array.isArray(scene.sources) ||
    scene.sources.length < 2 ||
    scene.sources.length > 32
  )
    fail();
  let bytes = 64;
  const seen = new Set<string>();
  for (const source of scene.sources) {
    keys(record(source), ["id", "eligible", "labels", "selected", "sampled"]);
    if (
      typeof source.id !== "string" ||
      source.id.length > 256 ||
      seen.has(source.id) ||
      source.eligible !== true ||
      !(source.labels instanceof Uint32Array) ||
      !Number.isSafeInteger(source.sampled) ||
      source.sampled < 0 ||
      source.sampled > 0xffffffff ||
      !Array.isArray(source.selected) ||
      source.selected.length > 64
    )
      fail();
    seen.add(source.id);
    bytes += 256 + source.id.length * 2 + 64;
    let count = 0;
    for (const cell of source.selected) {
      if (!Array.isArray(cell)) fail();
      count += cell.length;
      if (
        count > 16384 ||
        cell.some(
          (id) => !Number.isSafeInteger(id) || id < 0 || id > 0xffffffff,
        )
      )
        fail();
      bytes += 64 + cell.length * 32;
    }
  }
  const reserved = bytes * 2;
  if (!Number.isSafeInteger(reserved) || reserved > 16 * 1048576) fail();
  return reserved;
}
