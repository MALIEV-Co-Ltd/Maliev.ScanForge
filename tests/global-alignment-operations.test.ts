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
  validateGlobalAlignmentPreview,
} from "../src/automation/global-alignment-operations";
const native = vi.hoisted(() => ({
  prepare: vi.fn(),
  refine: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../src/global-alignment-input", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/global-alignment-input")>();
  return { ...original, prepareGlobalAlignmentInput: native.prepare };
});
vi.mock("../src/scan-global-registration", () => ({
  refineGlobalScanSet: native.refine,
}));
const entity = (id: string): Entity => ({
  id,
  name: id,
  kind: "mesh",
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  visible: true,
  color: "#aaa",
  opacity: 1,
});
const matrix = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function outerResult(converged = true) {
  return {
    passes: 2,
    order: ["a", "b"],
    seed: 1,
    states: ["a", "b"].map((id, i) => ({
      id,
      matrix: matrix(),
      pointCount: 3,
      mean: 0,
      std: 100,
      converged: i === 0 ? converged : true,
      stable: true,
    })),
    applications: ["a", "b", "a", "b"].map((id) => ({ id, matrix: matrix() })),
  };
}
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
  const host = {
    snapshot: () => state,
    commit: vi.fn((entities: Entity[]) => {
      state.history = [
        ...state.history,
        { entities: state.entities, label: "Global Fine Align" },
      ];
      state.entities = entities;
    }),
    showDatumPreview: vi.fn(),
    setInterface: vi.fn(),
    inspectApplication: () => ({ previews: {} }),
  } as unknown as WorkspaceHost;
  const controller = new AbortController();
  const context = {
    signal: controller.signal,
    check: () => controller.signal.throwIfAborted(),
    progress: vi.fn(),
  } as unknown as CommandContext;
  const output = state.entities.map((e) => ({
    ...e,
    positions: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]),
  }));
  native.prepare.mockImplementation(async (_entities, options) => ({
    input: { scans: [], radius: options.searchTolerance },
    entities: state.entities,
    summary: { scanCount: 2 },
    release: native.release,
  }));
  native.refine.mockResolvedValue({
    entities: output,
    outer: outerResult(),
    diagnostics: { localResults: [{ status: 0 }] },
  });
  return {
    state,
    host,
    context,
    controller,
    output,
    ops: createGlobalAlignmentOperations(host),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
it("stages a preview without history and applies the exact computed objects once", async () => {
  const h = harness(),
    original = h.state.entities;
  const preview = (await h.ops.global_alignment_preview({}, h.context)) as any;
  expect(h.state.entities).toBe(original);
  expect(h.state.history).toHaveLength(0);
  expect(h.host.showDatumPreview).toHaveBeenLastCalledWith(h.output);
  expect(native.release).toHaveBeenCalledOnce();
  expect(preview).toMatchObject({
    state: "preview",
    entityIds: ["a", "b"],
    converged: true,
  });
  await h.ops.global_alignment_apply(
    { previewId: preview.previewId },
    h.context,
  );
  expect(h.state.entities[0]).toBe(h.output[0]);
  expect(h.state.history).toHaveLength(1);
  expect(h.host.setInterface).toHaveBeenLastCalledWith({
    globalAlignmentOpen: false,
  });
  expect(native.refine).toHaveBeenCalledOnce();
  expect(inspectGlobalAlignmentPreview(h.host)).toMatchObject({
    state: "idle",
  });
});
it("passes persisted UI tolerance and verified handler numeric settings", async () => {
  const h = harness();
  await h.ops.global_alignment_preview({}, h.context);
  expect(native.prepare.mock.calls[0][1]).toMatchObject({
    searchTolerance: 0.5,
  });
  expect(native.refine.mock.calls[0][2]).toMatchObject({
    localTolerance: 0.001,
    coverageTolerance: 0.05,
  });
  releaseGlobalAlignmentPreview(h.host);
});
it.each([
  { input: 0, normalized: 0 },
  { input: -0.1, normalized: 0.10000000149011612 },
  { input: 0.123456789, normalized: 0.12345679104328156 },
])(
  "normalizes native search tolerance $input before preparation and state publication",
  async ({ input, normalized }) => {
    const h = harness();
    const preview = (await h.ops.global_alignment_preview(
      { searchTolerance: input },
      h.context,
    )) as any;
    expect(native.prepare.mock.calls[0][1].searchTolerance).toBe(normalized);
    expect(preview.settings.searchTolerance).toBe(normalized);
    releaseGlobalAlignmentPreview(h.host);
  },
);
it.each([Number.MAX_VALUE, Infinity, NaN, "0.5"])(
  "rejects invalid native search tolerance %s before allocation",
  async (input) => {
    const h = harness();
    await expect(
      h.ops.global_alignment_preview({ searchTolerance: input }, h.context),
    ).rejects.toThrow();
    expect(native.prepare).not.toHaveBeenCalled();
    expect(inspectGlobalAlignmentPreview(h.host).state).toBe("idle");
  },
);
it("cancel releases the display without altering authored history", async () => {
  const h = harness();
  await h.ops.global_alignment_preview({}, h.context);
  await h.ops.global_alignment_cancel({}, h.context);
  expect(h.host.showDatumPreview).toHaveBeenLastCalledWith(null);
  expect(h.host.commit).not.toHaveBeenCalled();
  expect(h.host.setInterface).toHaveBeenLastCalledWith({
    globalAlignmentOpen: false,
  });
  expect(inspectGlobalAlignmentPreview(h.host).state).toBe("idle");
});
it("expires retained output after sixty seconds", async () => {
  const h = harness(),
    preview = (await h.ops.global_alignment_preview({}, h.context)) as any;
  vi.advanceTimersByTime(60000);
  await expect(
    h.ops.global_alignment_apply({ previewId: preview.previewId }, h.context),
  ).rejects.toThrow(/expired|preview/i);
  expect(h.host.commit).not.toHaveBeenCalled();
  expect(h.host.showDatumPreview).toHaveBeenLastCalledWith(null);
});
it.each(["identity", "settings", "history", "locked", "hidden", "indexed"])(
  "rejects stale %s before applying",
  async (cause) => {
    const h = harness(),
      source = h.state.entities[0];
    source.meshSelection = { hidden: [], saved: [] };
    source.indexedMesh = {
      vertices: source.positions,
      triangles: new Uint32Array([0, 1, 2]),
    };
    const preview = (await h.ops.global_alignment_preview(
      {},
      h.context,
    )) as any;
    if (cause === "identity")
      h.state.entities = h.state.entities.map((e) => ({ ...e }));
    if (cause === "settings") h.state.settings.changed = true;
    if (cause === "history")
      h.state.history.push({ entities: [], label: "external" });
    if (cause === "locked") h.state.entities[0].locked = true;
    if (cause === "hidden") source.meshSelection.hidden.push(0);
    if (cause === "indexed")
      source.indexedMesh.triangles = new Uint32Array([2, 1, 0]);
    expect(validateGlobalAlignmentPreview(h.host)).toBe(false);
    await expect(
      h.ops.global_alignment_apply({ previewId: preview.previewId }, h.context),
    ).rejects.toThrow();
    expect(h.host.commit).not.toHaveBeenCalled();
  },
);
it("rejects a competing preview without replacing staged output", async () => {
  const h = harness();
  await h.ops.global_alignment_preview({}, h.context);
  await expect(h.ops.global_alignment_preview({}, h.context)).rejects.toThrow(
    /preview|cancel/i,
  );
  expect(native.refine).toHaveBeenCalledOnce();
  releaseGlobalAlignmentPreview(h.host);
});
it("rejects another preview owner before preparing input", async () => {
  const h = harness();
  h.host.inspectApplication = () => ({ previews: { datum: true } });
  await expect(h.ops.global_alignment_preview({}, h.context)).rejects.toThrow(
    /preview|cancel/i,
  );
  expect(native.prepare).not.toHaveBeenCalled();
});
it("enforces the public scan count and locked source limits before allocation", async () => {
  const h = harness();
  h.state.entities = Array.from({ length: 33 }, (_, i) => entity(String(i)));
  await expect(h.ops.global_alignment_preview({}, h.context)).rejects.toThrow(
    /32|limit/i,
  );
  h.state.entities = [entity("a"), { ...entity("b"), locked: true }];
  await expect(
    h.ops.global_alignment_preview({ entityIds: ["a", "b"] }, h.context),
  ).rejects.toThrow(/locked/i);
  expect(native.prepare).not.toHaveBeenCalled();
});
it("generic lifecycle release aborts a preparation and prevents later publication", async () => {
  const h = harness();
  let complete!: (value: unknown) => void;
  native.refine.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const pending = h.ops.global_alignment_preview(
    {},
    h.context,
  ) as Promise<unknown>;
  // Dynamic module imports may take multiple microtask turns.
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  releaseGlobalAlignmentPreview(h.host);
  complete({ entities: h.output, outer: outerResult(), diagnostics: {} });
  await expect(pending).rejects.toThrow();
  expect(h.host.showDatumPreview).not.toHaveBeenCalled();
  expect(native.release).toHaveBeenCalledOnce();
});
it("cleans preparation references if cancellation arrives after native completion", async () => {
  const h = harness();
  native.refine.mockImplementationOnce(async () => {
    h.controller.abort();
    return { entities: h.output, outer: outerResult(), diagnostics: {} };
  });
  await expect(
    h.ops.global_alignment_preview({}, h.context),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(native.release).toHaveBeenCalledOnce();
  expect(h.host.showDatumPreview).not.toHaveBeenCalled();
  expect(inspectGlobalAlignmentPreview(h.host).state).toBe("idle");
});
it("reports nonconvergence explicitly while preserving a reviewable preview", async () => {
  const h = harness();
  native.refine.mockResolvedValueOnce({
    entities: h.output,
    outer: outerResult(false),
    diagnostics: { localResults: [{ status: -2 }] },
  });
  const preview = (await h.ops.global_alignment_preview({}, h.context)) as any;
  expect(preview).toMatchObject({
    state: "preview",
    converged: false,
    diagnostics: { localResults: [{ status: -2 }] },
  });
  expect(h.host.commit).not.toHaveBeenCalled();
  releaseGlobalAlignmentPreview(h.host);
});
