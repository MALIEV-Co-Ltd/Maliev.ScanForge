import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { importScan } from "../src/import-client";
import { prepareImportedScan } from "../src/imported-scan";

vi.mock("../src/import-client", () => ({ importScan: vi.fn() }));
const apis: ApplicationApi[] = [];
afterEach(() => {
  apis.splice(0).forEach((api) => api.dispose());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
function setup() {
  vi.stubGlobal("navigator", { hardwareConcurrency: 1, deviceMemory: 2 });
  const state: WorkspaceSnapshot = {
    name: "RGB",
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
    cad: () => {
      throw Error("unused CAD");
    },
    commit: (entities, label) => {
      state.history.push({ entities: state.entities, label });
      state.entities = entities;
      state.future = [];
    },
    replace: (project) => {
      state.entities = project.entities;
    },
    select: (id) => {
      state.selectedId = id;
    },
    setSelection: (id, selection) => {
      state.selectedId = id;
      state.selection = selection;
    },
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    present: async () => {},
    settings: (patch) => {
      state.settings = { ...state.settings, ...patch };
    },
    busy: () => busy,
    activity: (value) => {
      busy = value;
    },
  };
  const api = new ApplicationApi(host, createOperations(host));
  apis.push(api);
  return { api, state };
}
async function result(
  api: ApplicationApi,
  tool: string,
  args: Record<string, unknown>,
) {
  const wire = await api.invoke(tool, args);
  if (!wire.ok) throw Error(wire.error.message);
  return wire.result as any;
}
async function finish(api: ApplicationApi, jobId: string) {
  for (let i = 0; i < 100; i++) {
    const job = await result(api, "job_get", { jobId });
    if (job.status !== "running") {
      expect(job.status).toBe("succeeded");
      return job.result;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw Error("Small import did not settle");
}
it.each(["project_import", "project_import_batch"])(
  "exposes shared ASC modes for %s, preserving bytes and bounded summaries",
  async (tool) => {
    const { api, state } = setup();
    const colors = Uint8Array.of(10, 20, 30, 255);
    vi.mocked(importScan).mockImplementation(async (_file, options) => {
      options?.onPointCloud?.({ pointColors: colors });
      return Float32Array.of(1, 2, 3);
    });
    const revision = api.currentRevision();
    await result(api, "settings_set", {
      patch: { importAscAttributes: "xyz-normal" },
      expectedRevision: revision,
      requestId: "setting",
    });
    expect(api.currentRevision()).toBeGreaterThan(revision);
    expect(state.history).toHaveLength(0);
    expect(
      (await result(api, "project_get", {})).settings.importAscAttributes,
    ).toBe("xyz-normal");
    const { artifactId } = await result(api, "artifact_put", {
      name: "colors.asc",
      offset: 0,
      base64: Buffer.from("1 2 3 10 20 30").toString("base64"),
    });
    const request = {
      ...(tool === "project_import"
        ? { artifactId }
        : { artifactIds: [artifactId] }),
      ascAttributes: "xyz-rgb",
      expectedRevision: api.currentRevision(),
      requestId: "import",
    };
    const job = await result(api, tool, request);
    await finish(api, job.jobId);
    expect(vi.mocked(importScan).mock.calls[0][1]?.ascAttributes).toBe(
      "xyz-rgb",
    );
    expect(state.entities[0].pointColors).toBe(colors);
    expect(state.entities[0].ascAttributes).toBe("xyz-rgb");
    const object = (await result(api, "project_get", {})).objects[0];
    expect(object).not.toHaveProperty("pointColors");
    expect(object.pointColorAttributes).toEqual({
      encoding: "rgba8",
      points: 1,
      bytes: 4,
    });
    expect(state.settings.importAscAttributes).toBe("xyz-normal");
    expect(await api.invoke(tool, request)).toMatchObject({
      ok: true,
      result: job,
    });
    expect(vi.mocked(importScan)).toHaveBeenCalledTimes(1);
  },
);
it("tracks color-only changes in revision identity and defaults shared preparation to RGB", async () => {
  const { api, state } = setup();
  vi.mocked(importScan).mockResolvedValue(Float32Array.of(1, 2, 3));
  const entity = await prepareImportedScan(new File(["1 2 3"], "a.asc"));
  expect(vi.mocked(importScan).mock.calls[0][1]?.ascAttributes).toBe("xyz-rgb");
  state.entities = [entity];
  const before = api.currentRevision();
  state.entities = [{ ...entity, pointColors: Uint8Array.of(1, 2, 3, 255) }];
  expect(api.currentRevision()).toBeGreaterThan(before);
});
