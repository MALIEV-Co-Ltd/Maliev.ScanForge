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
const hosts: WorkspaceHost[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
});
afterEach(() => {
  for (const host of hosts.splice(0)) releaseGlobalAlignmentPreview(host);
  vi.clearAllTimers();
  vi.useRealTimers();
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
function harness() {
  const state: WorkspaceSnapshot = {
    name: "test",
    entities: [entity("a"), entity("b")],
    history: [],
    future: [],
    authoring: {},
    selectedId: "a",
    selection: null,
    settings: {},
  };
  const commit = vi.fn((entities: Entity[]) => {
    state.history = [
      ...state.history,
      { entities: state.entities, label: "Global Fine Align" },
    ];
    state.entities = entities;
  });
  const host = {
    snapshot: () => state,
    commit,
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
  const scans = state.entities.map((e) => ({
    id: e.id,
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
  const output = state.entities.map((e) => ({
    ...e,
    positions: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]),
  }));
  const result = {
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
      states: state.entities.map((e) => ({
        id: e.id,
        matrix: receiptMatrix(),
        pointCount: 1,
        mean: 0,
        std: 100,
        converged: true,
        stable: true,
      })),
    },
  };
  return {
    state,
    host,
    commit,
    context,
    scans,
    output,
    result,
    ops: createGlobalAlignmentOperations(host),
  };
}

it("shared GUI/MCP preview retires consumed input once before staged geometry is produced and retains exact Apply output", async () => {
  const h = harness(),
    originals = h.state.entities;
  native.refine.mockImplementation(
    async (_input, _entities, options: { onInputConsumed?: () => void }) => {
      expect(h.scans).toHaveLength(2);
      expect(native.release).not.toHaveBeenCalled();
      // Baseline is expected to fail here: the adapter does not pass this hook.
      expect(options.onInputConsumed).toBeTypeOf("function");
      options.onInputConsumed!();
      options.onInputConsumed!();
      expect(native.release).toHaveBeenCalledOnce();
      expect(h.scans).toHaveLength(0);
      expect(h.state.entities).toBe(originals);
      expect(h.commit).not.toHaveBeenCalled();
      return h.result;
    },
  );
  const preview = (await h.ops.global_alignment_preview({}, h.context)) as {
    previewId: string;
    state: string;
  };
  expect(preview.state).toBe("preview");
  expect(native.release).toHaveBeenCalledOnce();
  expect(h.state.history).toHaveLength(0);
  await h.ops.global_alignment_apply(
    { previewId: preview.previewId },
    h.context,
  );
  expect(h.commit).toHaveBeenCalledOnce();
  expect(h.state.entities[0]).toBe(h.output[0]);
  expect(h.state.history).toHaveLength(1);
  expect(native.refine).toHaveBeenCalledOnce();
});

it("a setter failure after input consumption preserves its error and does not publish or double-release", async () => {
  const h = harness(),
    failure = Error("owned setter failed"),
    originals = h.state.entities;
  native.refine.mockImplementation(
    async (_input, _entities, options: { onInputConsumed?: () => void }) => {
      expect(options.onInputConsumed).toBeTypeOf("function");
      options.onInputConsumed!();
      expect(native.release).toHaveBeenCalledOnce();
      throw failure;
    },
  );
  await expect(h.ops.global_alignment_preview({}, h.context)).rejects.toBe(
    failure,
  );
  expect(native.release).toHaveBeenCalledOnce();
  expect(h.scans).toHaveLength(0);
  expect(h.state.entities).toBe(originals);
  expect(h.state.history).toHaveLength(0);
  expect(h.commit).not.toHaveBeenCalled();
  expect(inspectGlobalAlignmentPreview(h.host).state).toBe("idle");
});
