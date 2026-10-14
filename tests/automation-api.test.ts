import { describe, it, expect, vi } from "vitest";
import {
  ApplicationApi,
  validateInput,
  type WorkspaceHost,
  type WorkspaceSnapshot,
  type Handler,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { createAuthoringOperations } from "../src/automation/authoring-operations";
import { createWorkflowOperations } from "../src/automation/workflow-operations";
import catalog from "../src/automation/catalog.json";
import type { CadClient } from "../src/cad/client";
function setup(handlers?: Record<string, Handler>) {
  const state: WorkspaceSnapshot = {
    name: "Test",
    entities: [],
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
    cad: () => ({}) as CadClient,
    commit: (entities, label) => {
      state.history = [...state.history, { entities: state.entities, label }];
      state.entities = entities;
    },
    replace: (project) => {
      state.entities = project.entities;
      state.name = project.name;
    },
    select: (id) => {
      state.selectedId = id;
    },
    setSelection: (id, mask) => {
      state.selectedId = id;
      state.selection = mask;
    },
    setSketch: (sketch) => {
      state.authoring = { sketch };
    },
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: (patch) => {
      state.settings = { ...state.settings, ...patch };
    },
    busy: () => busy,
    activity: (running) => {
      busy = running;
    },
  };
  const operations = {
    ...createOperations(host),
    ...createAuthoringOperations(host),
    ...createWorkflowOperations(host),
  };
  return {
    state,
    host,
    api: new ApplicationApi(host, handlers ?? operations),
    operations,
  };
}
const mutation = (api: ApplicationApi, requestId = "request-1") => ({
  expectedRevision: api.currentRevision(),
  requestId,
});
describe("shared application API", () => {
  it("imports every artifact in one batch job without mistaking its own commits for revision conflicts", async () => {
    const { api, host, state } = setup();
    let sequence = 0;
    host.cad = () =>
      ({
        importFile: async () => ({
          kernelId: `shape-${++sequence}`,
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          brep: "BREP",
        }),
      }) as unknown as CadClient;
    const artifactIds: string[] = [];
    for (const name of ["first.step", "second.step"]) {
      const put = await api.invoke("artifact_put", {
        name,
        offset: 0,
        base64: "Q0FE",
      });
      expect(put.ok).toBe(true);
      artifactIds.push(
        (put as { result: { artifactId: string } }).result.artifactId,
      );
    }
    const result = await api.invoke("project_import_batch", {
      ...mutation(api),
      artifactIds,
    });
    expect(result.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const job = await api.invoke("job_get", {
      jobId: (result as { result: { jobId: string } }).result.jobId,
    });
    expect(job).toMatchObject({
      ok: true,
      result: {
        status: "succeeded",
        result: { failed: [], completed: [{ triangles: 1 }, { triangles: 1 }] },
      },
    });
    expect(state.entities.map((e) => e.name)).toEqual([
      "first.step",
      "second.step",
    ]);
    expect(state.history).toHaveLength(2);
    api.dispose();
  });
  it("still rejects an external revision after an owned batch mutation", async () => {
    let host: WorkspaceHost;
    const { api, host: owned } = setup({
      mesh_process: async (_args, context) => {
        context.mutate!(() => host.commit([], "Owned change"));
        await Promise.resolve();
        host.commit([], "External edit");
        context.check();
      },
    });
    host = owned;
    const result = await api.invoke("mesh_process", {
      ...mutation(api),
      entityId: "scan",
      operation: {
        kind: "smooth",
        tolerance: 0.001,
        iterations: 1,
        strength: 0.2,
      },
    });
    expect(result.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const job = await api.invoke("job_get", {
      jobId: (result as { result: { jobId: string } }).result.jobId,
    });
    expect(job).toMatchObject({
      ok: true,
      result: { status: "failed", error: { code: "REVISION_CONFLICT" } },
    });
    api.dispose();
  });
  it("allows a job to acknowledge its own synchronous mutations while retaining revision checks", async () => {
    let host: WorkspaceHost;
    const { api, host: owned } = setup({
      mesh_process: async (_args, context) => {
        context.mutate!(() => host.commit([], "First owned change"));
        await Promise.resolve();
        context.check();
        context.mutate!(() => host.commit([], "Second owned change"));
        context.check();
        return { imported: 2 };
      },
    });
    host = owned;
    const result = await api.invoke("mesh_process", {
      ...mutation(api),
      entityId: "scan",
      operation: {
        kind: "smooth",
        tolerance: 0.001,
        iterations: 1,
        strength: 0.2,
      },
    });
    expect(result.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const receipt = await api.invoke("job_get", {
      jobId: (result as { result: { jobId: string } }).result.jobId,
    });
    expect(receipt).toMatchObject({
      ok: true,
      result: { status: "succeeded", result: { imported: 2 } },
    });
    api.dispose();
  });
  it.each([
    { kind: "smooth", tolerance: 0.001, iterations: 2, strength: 0.2 },
    { kind: "scanEdit", action: "defeature" },
    {
      kind: "repair",
      tolerance: 0.001,
      fillHoles: false,
      planarityTolerance: 0.01,
      maxPerimeter: 10,
    },
  ])(
    "reports the shared ripple for MCP processing $kind",
    async (operation) => {
      const { api, host } = setup({
        mesh_process: async () => ({ done: true }),
      });
      const activity = vi.spyOn(host, "activity");
      const result = await api.invoke("mesh_process", {
        ...mutation(api),
        entityId: "mesh",
        operation,
      });
      expect(result.ok).toBe(true);
      expect(activity).toHaveBeenCalledWith(
        true,
        "Agent/API: mesh_process",
        "smoothing",
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(activity.mock.calls.some(([running]) => !running)).toBe(true);
      api.dispose();
    },
  );
  it("publishes only commands with a real handler or gateway implementation", async () => {
    const { api, operations } = setup();
    const builtins = [
      "capabilities_get",
      "session_get",
      "preview_discard",
      "tools_search",
      "job_get",
      "job_cancel",
      "artifact_put",
      "artifact_read",
      "artifact_delete",
    ];
    expect(
      catalog.every((c) => c.name in operations || builtins.includes(c.name)),
    ).toBe(true);
    expect(new Set(catalog.map((c) => c.name)).size).toBe(catalog.length);
    expect((await api.invoke("capabilities_get")).ok).toBe(true);
    api.dispose();
  });
  it("validates the published schemas, including variants and finite coordinates", async () => {
    const { api } = setup();
    const bad = await api.invoke("cad_create", {
      ...mutation(api),
      name: "Bad",
      recipe: {
        kind: "primitive",
        input: { kind: "box", center: [0, 0, NaN], size: [1, 1, 1] },
      },
    });
    expect(bad).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT" },
    });
    expect(
      await api.invoke("project_get", { kernelId: "hidden" }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(() =>
      validateInput(
        {
          type: "object",
          properties: { count: { type: "integer", minimum: 0 } },
          required: ["count"],
          additionalProperties: false,
        },
        { count: 1.5 },
      ),
    ).toThrow();
    api.dispose();
  });
  it("deduplicates identical requests even after their revision changed, and rejects changed reuse", async () => {
    const { api, host } = setup();
    const args = { ...mutation(api), patch: { theme: "dark" } };
    const first = await api.invoke("settings_set", args);
    const second = await api.invoke("settings_set", args);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true, revision: 1 });
    expect(
      await api.invoke("settings_set", { ...args, patch: { theme: "light" } }),
    ).toMatchObject({ ok: false, error: { code: "REQUEST_CONFLICT" } });
    expect(host.snapshot().settings.theme).toBe("dark");
    api.dispose();
  });
  it("detects human changes including display, history and selection", async () => {
    const { api, state } = setup();
    const args = mutation(api);
    state.name = "Human edited";
    expect(await api.invoke("history_undo", args)).toMatchObject({
      ok: false,
      error: { code: "REVISION_CONFLICT" },
    });
    const revision = api.currentRevision();
    state.selection = new Uint8Array([1]);
    expect(api.currentRevision()).toBe(revision + 1);
    api.dispose();
  });
  it("makes lightweight state reads available while a geometry job owns the lane", async () => {
    let finish!: () => void;
    const { api } = setup({
      project_get: () => ({ name: "Live" }),
      mesh_analyze: () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    });
    const started = await api.invoke("mesh_analyze", { entityId: "mesh" });
    expect(started).toMatchObject({ ok: true, result: { status: "running" } });
    expect(await api.invoke("project_get")).toMatchObject({
      ok: true,
      result: { name: "Live" },
    });
    expect(
      await api.invoke("mesh_analyze", { entityId: "mesh" }),
    ).toMatchObject({ ok: false, error: { code: "BUSY" } });
    finish();
    await Promise.resolve();
    api.dispose();
  });
  it("does not admit a new operation until cancelled work has actually settled", async () => {
    let finish!: () => void;
    let context!: Parameters<Handler>[1];
    const { api } = setup({
      mesh_analyze: async (_a, c) => {
        context = c;
        await new Promise<void>((r) => {
          finish = r;
        });
        c.check();
        return {};
      },
    });
    const start = await api.invoke("mesh_analyze", { entityId: "mesh" });
    const jobId = (start.ok ? (start.result as { jobId: string }) : null)!
      .jobId;
    await api.invoke("job_cancel", { jobId });
    expect(context.signal.aborted).toBe(true);
    expect(
      await api.invoke("mesh_analyze", { entityId: "mesh" }),
    ).toMatchObject({ ok: false, error: { code: "BUSY" } });
    finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(await api.invoke("job_get", { jobId })).toMatchObject({
      ok: true,
      result: { status: "cancelled" },
    });
    api.dispose();
  });
  it("rejects stale asynchronous output instead of calling commit", async () => {
    let finish!: () => void;
    const commit = vi.fn();
    const { api, state } = setup({
      mesh_process: async (_a, c) => {
        await new Promise<void>((r) => {
          finish = r;
        });
        c.check();
        commit();
      },
    });
    const start = await api.invoke("mesh_process", {
      ...mutation(api),
      entityId: "mesh",
      operation: { kind: "scanTools", operation: { kind: "flipNormals" } },
    });
    const jobId = (start.ok ? (start.result as { jobId: string }) : null)!
      .jobId;
    state.name = "External change";
    finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(commit).not.toHaveBeenCalled();
    expect(await api.invoke("job_get", { jobId })).toMatchObject({
      ok: true,
      result: { status: "failed", error: { code: "REVISION_CONFLICT" } },
    });
    api.dispose();
  });
  it("enforces ordered upload chunks, preserves filenames and supports exact readback/deletion", async () => {
    const { api } = setup();
    const first = await api.invoke("artifact_put", {
      name: "scan.stl",
      base64: btoa("abc"),
      offset: 0,
    });
    const artifactId = (
      first.ok ? (first.result as { artifactId: string }) : null
    )!.artifactId;
    expect(
      await api.invoke("artifact_put", {
        name: "scan.stl",
        base64: btoa("d"),
        artifactId,
        offset: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: "UPLOAD_CONFLICT" } });
    await api.invoke("artifact_put", {
      name: "scan.stl",
      base64: btoa("d"),
      artifactId,
      offset: 3,
    });
    expect(
      await api.invoke("artifact_read", { artifactId, offset: 1, length: 2 }),
    ).toMatchObject({
      ok: true,
      result: {
        name: "scan.stl",
        base64: btoa("bc"),
        nextOffset: 3,
        eof: false,
      },
    });
    await api.invoke("artifact_delete", { artifactId });
    expect(await api.invoke("artifact_read", { artifactId })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    api.dispose();
  });
  it("fails closed after disposal and rejects malformed base64", async () => {
    const { api } = setup();
    expect(
      await api.invoke("artifact_put", {
        name: "a.stl",
        base64: "!invalid",
        offset: 0,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    api.dispose();
    expect(await api.invoke("project_get")).toMatchObject({
      ok: false,
      error: { code: "DISCONNECTED" },
    });
  });
});
