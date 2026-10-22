const receiptMatrix = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  CommandContext,
  WorkspaceHost,
  WorkspaceSnapshot,
} from "../src/automation/api";
import type { Entity } from "../src/types";
import {
  createGlobalAlignmentOperations,
  inspectGlobalAlignmentPreview,
  releaseGlobalAlignmentPreview,
} from "../src/automation/global-alignment-operations";
import {
  ownedWorkerCleanupPending,
  requestOwnedWorkerStop,
  retryOwnedWorkerStops,
} from "../src/scan-global-worker-cleanup";

const native = vi.hoisted(() => ({
  prepare: vi.fn(),
  refine: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../src/global-alignment-input", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/global-alignment-input")>()),
  prepareGlobalAlignmentInput: native.prepare,
}));
vi.mock("../src/scan-global-registration", () => ({
  refineGlobalScanSet: native.refine,
}));

const owner = "input-preflight-regression-exact-worker";
const hosts: WorkspaceHost[] = [];
let stopFails = true;
const exactWorker = {
  onmessage: null,
  onerror: null,
  onmessageerror: null,
  terminate: vi.fn(() => {
    if (stopFails) throw Error("preflight exact worker stop failed");
  }),
} as unknown as Worker;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  stopFails = true;
  // resetAllMocks clears implementations, so reinstall this persistent failure.
  vi.mocked(exactWorker.terminate).mockImplementation(() => {
    if (stopFails) throw Error("preflight exact worker stop failed");
  });
  expect(ownedWorkerCleanupPending()).toEqual([]);
});
afterEach(() => {
  // Release only this test's exact recovery handle and preview lease.
  stopFails = false;
  retryOwnedWorkerStops([owner]);
  for (const host of hosts.splice(0)) releaseGlobalAlignmentPreview(host);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const entity = (id: string): Entity => ({
  id,
  name: id,
  kind: "mesh",
  visible: true,
  color: "#aaa",
  opacity: 1,
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
});

it("blocks shared preview before normal preparation while an exact worker stop is unresolved, then recovers", async () => {
  const state: WorkspaceSnapshot = {
    name: "preflight",
    entities: [entity("a"), entity("b")],
    history: [],
    future: [],
    authoring: {},
    selectedId: "a",
    selection: null,
    settings: {},
  };
  const originalEntities = state.entities;
  const originalHistory = state.history;
  const host = {
    snapshot: () => state,
    commit: vi.fn(),
    showDatumPreview: vi.fn(),
    setInterface: vi.fn(),
    inspectApplication: () => ({ previews: {} }),
  } as unknown as WorkspaceHost;
  hosts.push(host);
  const controller = new AbortController();
  const context = {
    signal: controller.signal,
    check: () => controller.signal.throwIfAborted(),
    progress: vi.fn(),
  } as unknown as CommandContext;
  const scans = state.entities.map((source) => ({
    id: source.id,
    geometry: {
      points: new Float32Array([0, 0, 0]),
      normals: new Float32Array([0, 0, 1]),
    },
  }));
  native.release.mockImplementation(() => {
    scans.length = 0;
  });
  native.prepare.mockResolvedValue({
    input: { scans, radius: 0.5 },
    entities: state.entities,
    summary: { scanCount: 2 },
    release: native.release,
  });
  const output = state.entities.map((source) => ({
    ...source,
    positions: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]),
  }));
  native.refine.mockImplementation(
    async (_input, _entities, options: { onInputConsumed?: () => void }) => {
      options.onInputConsumed?.();
      return {
        entities: output,
        diagnostics: { localResults: [{ status: 0 }] },
        outer: {
          passes: 1,
          order: ["a", "b"],
          gaugeId: "a",
          seed: 123,
          applications: ["a", "b", "a", "b"].map((id) => ({
            id,
            matrix: receiptMatrix(),
          })),
          states: state.entities.map((source) => ({
            id: source.id,
            matrix: receiptMatrix(),
            pointCount: 1,
            mean: 0,
            std: 100,
            converged: true,
            stable: true,
          })),
        },
      };
    },
  );
  const ops = createGlobalAlignmentOperations(host);
  requestOwnedWorkerStop(exactWorker, {
    owner,
    runId: 1,
    target: "normal-preparation",
    createdUnixMs: Date.now(),
    expiresUnixMs: Date.now() + 60_000,
  });
  expect(ownedWorkerCleanupPending()).toMatchObject([
    { owner, retained: true, status: "termination-unconfirmed" },
  ]);

  await expect(ops.global_alignment_preview({}, context)).rejects.toThrow(
    "Unresolved exact worker cleanup",
  );
  expect(native.prepare).not.toHaveBeenCalled();
  expect(native.refine).not.toHaveBeenCalled();
  expect(host.showDatumPreview).not.toHaveBeenCalled();
  expect(host.commit).not.toHaveBeenCalled();
  expect(state.entities).toBe(originalEntities);
  expect(state.history).toBe(originalHistory);
  expect(inspectGlobalAlignmentPreview(host).state).toBe("idle");
  expect(ownedWorkerCleanupPending()).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);

  // Recovery uses the actual registry, never an invented reset/clear API.
  stopFails = false;
  retryOwnedWorkerStops([owner]);
  expect(ownedWorkerCleanupPending()).toEqual([]);
  const preview = (await ops.global_alignment_preview({}, context)) as {
    state: string;
  };
  expect(preview.state).toBe("preview");
  expect(native.prepare).toHaveBeenCalledOnce();
  expect(native.refine).toHaveBeenCalledOnce();
  expect(native.release).toHaveBeenCalledOnce();
  expect(host.showDatumPreview).toHaveBeenCalledOnce();
  expect(host.commit).not.toHaveBeenCalled();
  expect(state.entities).toBe(originalEntities);
  expect(state.history).toBe(originalHistory);
  expect(ownedWorkerCleanupPending()).toEqual([]);
  expect(vi.getTimerCount()).toBe(1); // Only the existing finite preview lease.
  releaseGlobalAlignmentPreview(host);
  expect(inspectGlobalAlignmentPreview(host).state).toBe("idle");
  expect(vi.getTimerCount()).toBe(0);
}, 2_000);
