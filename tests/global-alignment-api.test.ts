import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type ApiResult,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import {
  createGlobalAlignmentOperations,
  inspectGlobalAlignmentPreview,
} from "../src/automation/global-alignment-operations";
import catalog from "../src/automation/catalog.json";
import type { Entity } from "../src/types";

const solver = vi.hoisted(() => ({ prepare: vi.fn(), refine: vi.fn() }));
vi.mock("../src/global-alignment-input", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/global-alignment-input")>()),
  prepareGlobalAlignmentInput: solver.prepare,
}));
vi.mock("../src/scan-global-registration", () => ({
  refineGlobalScanSet: solver.refine,
}));

// Match the application's eager module loading so cancellation readiness measures
// the mocked running operation rather than cold Vite transformation.
await import("../src/global-alignment-input");
await import("../src/scan-global-registration");

const apis: ApplicationApi[] = [];
function value<T>(response: ApiResult): T {
  expect(response.ok).toBe(true);
  if (!response.ok) throw Error(response.error.message);
  return response.result as T;
}
function mesh(id: string): Entity {
  return {
    id,
    name: id,
    kind: "mesh",
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    visible: true,
    color: "#aaa",
    opacity: 1,
  };
}
function setup() {
  const state: WorkspaceSnapshot = {
    name: "Global alignment API test",
    entities: [mesh("a"), mesh("b")],
    history: [],
    future: [],
    authoring: {},
    selectedId: null,
    selection: null,
    settings: {},
  };
  let busy = false;
  const host: WorkspaceHost = {
    snapshot: () => ({ ...state }),
    cad: () => {
      throw Error("This API contract test must not initialize CAD.");
    },
    commit: vi.fn((entities, label) => {
      state.history = [...state.history, { entities: state.entities, label }];
      state.entities = entities;
    }),
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => busy,
    activity: vi.fn((running) => {
      busy = running;
    }),
    showDatumPreview: vi.fn(),
    setInterface: vi.fn(),
    inspectApplication: () => ({ previews: {} }),
  };
  const output = state.entities.map((entity) => ({
    ...entity,
    positions: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]),
  }));
  const release = vi.fn();
  solver.prepare.mockImplementation(async () => ({
    input: { scans: [], radius: 0.5 },
    entities: state.entities,
    summary: { scanCount: 2 },
    release,
  }));
  solver.refine.mockResolvedValue({
    entities: output,
    outer: {
      passes: 1,
      order: ["a", "b"],
      seed: 1,
      states: ["a", "b"].map((id) => ({
        id,
        pointCount: 3,
        mean: 0,
        std: 100,
        converged: true,
        stable: true,
      })),
    },
    diagnostics: { localResults: [] },
  });
  const handlers = createGlobalAlignmentOperations(host);
  const api = new ApplicationApi(host, handlers);
  apis.push(api);
  let request = 0;
  const mutation = () => ({
    expectedRevision: api.currentRevision(),
    requestId: `global-alignment-${++request}`,
  });
  const start = async () => {
    const { jobId } = value<{ jobId: string }>(
      await api.invoke("global_alignment_preview", mutation()),
    );
    expect(jobId).toBeTypeOf("string");
    return jobId;
  };
  const settled = async (jobId: string, status: string) => {
    await vi.waitFor(async () => {
      expect(await api.invoke("job_get", { jobId })).toMatchObject({
        ok: true,
        result: { status },
      });
    });
  };
  return {
    api,
    host,
    state,
    output,
    release,
    mutation,
    start,
    settled,
    handlers,
  };
}

beforeEach(() => vi.resetAllMocks());
afterEach(async () => {
  for (const api of apis.splice(0)) api.dispose();
  // Abort-aware mock jobs settle and execute their finally blocks on disposal.
  await Promise.resolve();
  await Promise.resolve();
});

it("discovers the four shared global alignment operations with their runtime schemas", async () => {
  const { api } = setup();
  const names = [
    "global_alignment_state",
    "global_alignment_preview",
    "global_alignment_apply",
    "global_alignment_cancel",
  ];
  const discovered = value<{
    tools: { name: string; inputSchema: unknown }[];
  }>(
    await api.invoke("tools_search", {
      query: "global_alignment",
      limit: 20,
      includeSchemas: true,
    }),
  );
  expect(discovered.tools.map((tool) => tool.name).sort()).toEqual(
    [...names].sort(),
  );
  for (const name of names) {
    const published = catalog.find((tool) => tool.name === name);
    expect(published).toBeDefined();
    expect(
      discovered.tools.find((tool) => tool.name === name)?.inputSchema,
    ).toEqual(published!.inputSchema);
  }
  expect(catalog.find((tool) => tool.name === names[0])).toMatchObject({
    readOnly: true,
  });
  expect(catalog.find((tool) => tool.name === names[1])).toMatchObject({
    readOnly: false,
    job: true,
  });
  expect(await api.invoke("global_alignment_state", {})).toMatchObject({
    ok: true,
    result: { state: "idle", entityIds: [] },
  });
});

it.each([
  { entityIds: ["a"] },
  { entityIds: ["a", "a"] },
  { entityIds: Array.from({ length: 33 }, (_, i) => String(i)) },
  { searchTolerance: "0.5" },
  { parallel: "true" },
  { unsupportedOption: true },
])(
  "rejects invalid preview arguments before allocation: %j",
  async (options) => {
    const { api, host, mutation } = setup();
    expect(
      await api.invoke("global_alignment_preview", {
        ...mutation(),
        ...options,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(solver.prepare).not.toHaveBeenCalled();
    expect(host.activity).not.toHaveBeenCalled();
  },
);

it.each(["global_alignment_cancel", "scoped", "job_cancel", "preview_discard"])(
  "%s can cancel the owning global preview job while the workspace is busy",
  async (command) => {
    const h = setup();
    let signal: AbortSignal | undefined;
    solver.refine.mockImplementationOnce(
      async (_input, _entities, options: { signal: AbortSignal }) => {
        signal = options.signal;
        await new Promise((_, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            { once: true },
          );
        });
      },
    );
    const jobId = await h.start();
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(h.host.busy()).toBe(true);
    expect(await h.api.invoke("global_alignment_state", {})).toMatchObject({
      ok: true,
      result: { state: "preparing" },
    });
    expect(
      await h.api.invoke("global_alignment_apply", {
        ...h.mutation(),
        previewId: "not-prepared",
      }),
    ).toMatchObject({ ok: false, error: { code: "BUSY" } });
    const cancelled = await h.api.invoke(
      command === "scoped" ? "global_alignment_cancel" : command,
      command === "job_cancel"
        ? { jobId }
        : command === "scoped"
          ? { ...h.mutation(), jobId }
          : command === "preview_discard"
            ? { ...h.mutation(), target: "globalAlignment" }
            : h.mutation(),
    );
    expect(cancelled.ok).toBe(true);
    expect(signal!.aborted).toBe(true);
    await h.settled(jobId, "cancelled");
    expect(h.host.busy()).toBe(false);
    expect(h.release).toHaveBeenCalledOnce();
    expect(h.host.commit).not.toHaveBeenCalled();
    expect(inspectGlobalAlignmentPreview(h.host).state).toBe("idle");
  },
);

it.each(["cancelled", "expired"])(
  "old panel cleanup cannot cancel a newer preview after its job was %s",
  async (replacement) => {
    const h = setup();
    const previousJobId = await h.start();
    await h.settled(previousJobId, "succeeded");
    if (replacement === "cancelled") {
      value(await h.api.invoke("global_alignment_cancel", h.mutation()));
    } else {
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001);
      try {
        expect(inspectGlobalAlignmentPreview(h.host).state).toBe("idle");
      } finally {
        clock.mockRestore();
      }
    }
    const newJobId = await h.start();
    await h.settled(newJobId, "succeeded");
    const before = inspectGlobalAlignmentPreview(h.host);
    vi.mocked(h.host.showDatumPreview!).mockClear();
    vi.mocked(h.host.setInterface!).mockClear();
    expect(
      await h.api.invoke("global_alignment_cancel", {
        ...h.mutation(),
        jobId: previousJobId,
      }),
    ).toMatchObject({ ok: true, result: { cancelled: false } });
    expect(inspectGlobalAlignmentPreview(h.host)).toEqual(before);
    expect(h.host.showDatumPreview).not.toHaveBeenCalled();
    expect(h.host.setInterface).not.toHaveBeenCalled();
    expect(h.host.commit).not.toHaveBeenCalled();
  },
);

it("a rejected panel launch cannot cancel an agent's running preview by another job ID", async () => {
  const h = setup();
  let signal: AbortSignal | undefined;
  solver.refine.mockImplementationOnce(
    async (_input, _entities, options: { signal: AbortSignal }) => {
      signal = options.signal;
      await new Promise((_, reject) =>
        options.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        ),
      );
    },
  );
  const jobId = await h.start();
  await vi.waitFor(() => expect(signal).toBeDefined());
  expect(
    await h.api.invoke("global_alignment_preview", h.mutation()),
  ).toMatchObject({ ok: false, error: { code: "BUSY" } });
  const before = inspectGlobalAlignmentPreview(h.host);
  vi.mocked(h.host.setInterface!).mockClear();
  expect(
    await h.api.invoke("global_alignment_cancel", {
      ...h.mutation(),
      jobId: "a-different-job",
    }),
  ).toMatchObject({ ok: true, result: { cancelled: false } });
  expect(signal!.aborted).toBe(false);
  expect(h.host.busy()).toBe(true);
  expect(inspectGlobalAlignmentPreview(h.host)).toEqual(before);
  expect(h.host.setInterface).not.toHaveBeenCalled();
  value(
    await h.api.invoke("global_alignment_cancel", { ...h.mutation(), jobId }),
  );
  await h.settled(jobId, "cancelled");
});

it("disposal aborts in-flight preparation and prevents later display publication", async () => {
  const h = setup();
  let signal: AbortSignal | undefined;
  solver.refine.mockImplementationOnce(
    async (_input, _entities, options: { signal: AbortSignal }) => {
      signal = options.signal;
      await new Promise((_, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Disconnected", "AbortError")),
          { once: true },
        );
      });
    },
  );
  await h.start();
  await vi.waitFor(() => expect(signal).toBeDefined());
  expect(h.host.busy()).toBe(true);
  h.api.dispose();
  expect(signal!.aborted).toBe(true);
  await vi.waitFor(() => expect(h.host.busy()).toBe(false));
  expect(h.release).toHaveBeenCalledOnce();
  expect(inspectGlobalAlignmentPreview(h.host).state).toBe("idle");
  expect(h.host.showDatumPreview).not.toHaveBeenCalled();
  expect(h.host.commit).not.toHaveBeenCalled();
});

it("disposal releases a staged preview and rejects further API use", async () => {
  const h = setup();
  await h.settled(await h.start(), "succeeded");
  expect(inspectGlobalAlignmentPreview(h.host).state).toBe("preview");
  h.api.dispose();
  expect(inspectGlobalAlignmentPreview(h.host).state).toBe("idle");
  expect(h.host.showDatumPreview).toHaveBeenLastCalledWith(null);
  expect(h.host.commit).not.toHaveBeenCalled();
  expect(await h.api.invoke("global_alignment_state", {})).toMatchObject({
    ok: false,
    error: { code: "DISCONNECTED" },
  });
});

it("rejects both a stale API revision and stale geometry at the current revision", async () => {
  const h = setup();
  await h.settled(await h.start(), "succeeded");
  const preview = value<{ previewId: string }>(
    await h.api.invoke("global_alignment_state", {}),
  );
  const oldRevision = h.api.currentRevision();
  h.state.entities = h.state.entities.map((entity) => ({
    ...entity,
    positions: entity.positions.slice(),
  }));
  expect(
    await h.api.invoke("global_alignment_apply", {
      previewId: preview.previewId,
      expectedRevision: oldRevision,
      requestId: "stale-api-revision",
    }),
  ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  expect(
    await h.api.invoke("global_alignment_apply", {
      ...h.mutation(),
      previewId: preview.previewId,
    }),
  ).toMatchObject({ ok: false });
  expect(h.host.commit).not.toHaveBeenCalled();
  expect(h.host.showDatumPreview).toHaveBeenLastCalledWith(null);
  expect(inspectGlobalAlignmentPreview(h.host).state).toBe("idle");
});

it("applies the staged objects once through API dispatch and retry protection", async () => {
  const h = setup();
  await h.settled(await h.start(), "succeeded");
  const preview = value<{ previewId: string }>(
    await h.api.invoke("global_alignment_state", {}),
  );
  const request = { ...h.mutation(), previewId: preview.previewId };
  const applied = await h.api.invoke("global_alignment_apply", request);
  expect(applied).toMatchObject({ ok: true, result: { applied: true } });
  expect(await h.api.invoke("global_alignment_apply", request)).toEqual(
    applied,
  );
  expect(h.host.commit).toHaveBeenCalledOnce();
  expect(h.state.history).toHaveLength(1);
  expect(h.state.entities[0]).toBe(h.output[0]);
  expect(h.state.entities[1]).toBe(h.output[1]);
  expect(solver.refine).toHaveBeenCalledOnce();
});

it.each(["alignment_apply", "alignment_preview"])(
  "blocks competing coordinate %s before it can clear the global display",
  async (command) => {
    const h = setup();
    await h.settled(await h.start(), "succeeded");
    const preview = inspectGlobalAlignmentPreview(h.host);
    // An identity coordinate Apply still clears the shared display, even though
    // it creates no history revision to invalidate the global preview cache.
    const coordinate = vi.fn(() => {
      h.host.showDatumPreview?.(null);
      return { changed: false, preview: false };
    });
    h.handlers[command] = coordinate;
    vi.mocked(h.host.showDatumPreview!).mockClear();
    expect(
      await h.api.invoke(command, {
        ...h.mutation(),
        entityIds: ["a"],
        constraints: [{ kind: "point", point: [0, 0, 0], axis: 0 }],
      }),
    ).toMatchObject({ ok: false, error: { code: "BUSY" } });
    expect(coordinate).not.toHaveBeenCalled();
    expect(h.host.showDatumPreview).not.toHaveBeenCalled();
    expect(h.host.commit).not.toHaveBeenCalled();
    expect(inspectGlobalAlignmentPreview(h.host).previewId).toBe(
      preview.previewId,
    );
  },
);

it("discarding an idle global preview preserves an ordinary coordinate display", async () => {
  const h = setup();
  const ordinary = h.state.entities.map((entity) => ({ ...entity }));
  h.host.showDatumPreview?.(ordinary);
  h.host.inspectApplication = () => ({ previews: { datum: true } });
  h.host.discardPreview = vi.fn(() => h.host.showDatumPreview?.(null));
  vi.mocked(h.host.showDatumPreview!).mockClear();
  expect(
    await h.api.invoke("preview_discard", {
      ...h.mutation(),
      target: "globalAlignment",
    }),
  ).toMatchObject({
    ok: true,
    result: { target: "globalAlignment", cancellationRequested: true },
  });
  expect(h.host.discardPreview).not.toHaveBeenCalled();
  expect(h.host.showDatumPreview).not.toHaveBeenCalled();
  expect(h.host.setInterface).toHaveBeenLastCalledWith({
    globalAlignmentOpen: false,
  });
  expect(h.host.commit).not.toHaveBeenCalled();
});
