import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type CommandContext,
  type Handler,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import {
  beginReferenceConstructionPreview,
  inspectReferenceConstructionPreview,
} from "../src/automation/reference-construction-preview";
const apis: ApplicationApi[] = [];
function setup(handlers: Record<string, Handler> = {}) {
  const state: WorkspaceSnapshot = {
    name: "Model",
    projectId: "p",
    entities: [],
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: null,
    selection: null,
  };
  let busy = false;
  const host: WorkspaceHost = {
    cad: () => {
      throw new Error("Kernel not used");
    },
    commit: vi.fn(),
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    snapshot: () => state,
    busy: () => busy,
    activity: (value: boolean) => {
      busy = value;
    },
  };
  const api = new ApplicationApi(host, {
    project_get: () => ({ name: state.name }),
    ...handlers,
  });
  apis.push(api);
  return { api, state, host };
}
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
  vi.useRealTimers();
});
it("remains connected after a synchronous owner cleanup/setup replay", async () => {
  const { api } = setup();
  const release = api.retainOwner();
  release();
  const blocked = api.invoke("project_get");
  const releaseNext = api.retainOwner();
  expect(await blocked).toMatchObject({
    ok: false,
    error: { code: "DISCONNECTED" },
  });
  expect(await api.invoke("project_get")).toMatchObject({
    ok: true,
    result: { name: "Model" },
  });
  releaseNext();
});
it("disconnects immediately on true unmount and permanently closes after its microtask", async () => {
  const { api } = setup();
  const release = api.retainOwner();
  release();
  const blocked = api.invoke("project_get");
  expect(await blocked).toMatchObject({
    ok: false,
    error: { code: "DISCONNECTED" },
  });
  expect(() => api.retainOwner()).toThrow(/disposed|closed/);
});
it("keeps revision and exact retry receipts across an owner replay", async () => {
  const { state, host } = setup();
  let calls = 0;
  const separate = new ApplicationApi(host, {
    object_update: (_args, c) => {
      calls++;
      c.mutate!(() => {
        state.name = "Updated";
      });
      return { updated: true };
    },
  });
  apis.push(separate);
  const release = separate.retainOwner();
  const args = {
    entityId: "x",
    patch: { name: "Updated" },
    requestId: "same-request",
    expectedRevision: separate.currentRevision(),
  };
  const first = await separate.invoke("object_update", args);
  expect(first.ok).toBe(true);
  const revision = separate.currentRevision();
  release();
  const next = separate.retainOwner();
  expect(separate.currentRevision()).toBe(revision);
  expect(await separate.invoke("object_update", args)).toEqual(first);
  expect(calls).toBe(1);
  expect(
    await separate.invoke("object_update", {
      ...args,
      patch: { name: "Different" },
    }),
  ).toMatchObject({ ok: false, error: { code: "REQUEST_CONFLICT" } });
  next();
});
it("blocks an older asynchronous read result after reattachment", async () => {
  let complete!: () => void;
  const gate = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const { api } = setup({
    object_get: async () => {
      await gate;
      return { oldOwner: true };
    },
  });
  const release = api.retainOwner();
  const pending = api.invoke("object_get", { entityId: "x" });
  release();
  const next = api.retainOwner();
  complete();
  expect(await pending).toMatchObject({
    ok: false,
    error: { code: "DISCONNECTED" },
  });
  next();
});
it("cancels previous mutation work and accepts new work after it settles", async () => {
  let complete!: () => void;
  const gate = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let first = true;
  const { api, state } = setup({
    object_update: async (_args, c) => {
      if (first) {
        first = false;
        await gate;
      }
      c.mutate!(() => {
        state.name = "Written";
      });
      return { written: true };
    },
  });
  const release = api.retainOwner();
  const args = {
    entityId: "x",
    patch: { name: "Written" },
    requestId: "old",
    expectedRevision: api.currentRevision(),
  };
  const pending = api.invoke("object_update", args);
  release();
  const next = api.retainOwner();
  complete();
  expect(await pending).toMatchObject({
    ok: false,
    error: { code: "CANCELLED" },
  });
  expect(state.name).toBe("Model");
  expect(
    (await api.invoke("object_update", { ...args, requestId: "new" })).ok,
  ).toBe(true);
  next();
});
it("fences old artifact callbacks after an owner replay", async () => {
  let context!: CommandContext;
  const { api } = setup({
    object_get: (_a, c) => {
      context = c;
      return {};
    },
  });
  const release = api.retainOwner();
  await api.invoke("object_get", { entityId: "x" });
  const artifact = context.artifact(
    new Uint8Array([1]),
    "old.bin",
    "application/octet-stream",
  );
  release();
  const next = api.retainOwner();
  expect(() =>
    context.artifact(
      new Uint8Array([2]),
      "late.bin",
      "application/octet-stream",
    ),
  ).toThrow(/owner|closed/);
  expect(() => context.artifactBlob(artifact.artifactId)).toThrow(
    /owner|closed/,
  );
  next();
});
it("releases preview ownership immediately even when API finalization is deferred", () => {
  vi.useFakeTimers();
  const { api, host } = setup();
  const release = api.retainOwner();
  const clear = vi.fn();
  beginReferenceConstructionPreview(
    host,
    { show: vi.fn(), clear },
    {
      geometry: { kind: "point", position: [0, 0, 0] },
      state: { completionWord: 0 },
    },
    {
      definition: {
        version: 1,
        kind: "point",
        mode: "coordinates",
        position: [1, 2, 3],
        sources: [],
      },
      writeNumericInputs: true,
      evaluationAllowed: true,
    },
  );
  release();
  expect(clear).toHaveBeenCalledOnce();
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: false,
    reason: "disposed",
  });
  expect(vi.getTimerCount()).toBe(0);
  const next = api.retainOwner();
  next();
});
it("ignores stale/duplicate cleanup functions without detaching the newer owner", async () => {
  const { api } = setup();
  const release = api.retainOwner();
  expect(() => api.retainOwner()).toThrow(/owner/);
  release();
  const next = api.retainOwner();
  release();
  expect((await api.invoke("project_get")).ok).toBe(true);
  next();
});
it("cannot reattach an explicitly disposed API", () => {
  const { api } = setup();
  const release = api.retainOwner();
  api.dispose();
  expect(() => api.retainOwner()).toThrow(/disposed|closed/);
  expect(() => release()).not.toThrow();
});
