import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { importScan } from "../src/import-client";
import * as imported from "../src/imported-scan";
import { createOperations } from "../src/automation/operations";
import {
  ApplicationApi,
  validateInput,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import catalog from "../src/automation/catalog.json";

vi.mock("../src/import-client", () => ({ importScan: vi.fn() }));

const placements = [undefined, false, true] as const;
const formats = ["stl", "ply", "asc"] as const;
const cases = formats.flatMap((format) =>
  placements.map((placeAtOrigin) => ({ format, placeAtOrigin })),
);
const apis: ApplicationApi[] = [];

beforeEach(() => {
  vi.mocked(importScan).mockReset();
  vi.mocked(importScan).mockImplementation(async () =>
    Float32Array.of(20, 30, 40, 21, 30, 40, 20, 31, 40),
  );
  vi.stubGlobal("navigator", { hardwareConcurrency: 1, deviceMemory: 2 });
});
afterEach(() => {
  apis.splice(0).forEach((api) => api.dispose());
  vi.unstubAllGlobals();
});

it("declares preservation of the file frame as the shared import default", () => {
  expect(imported.DEFAULT_IMPORT_PLACE_AT_ORIGIN).toBe(false);
});

it.each(cases)(
  "forwards shared preparation placement for $format/$placeAtOrigin",
  async ({ format, placeAtOrigin }) => {
    const file = new File(["worker parser fixture"], `scan.${format}`);
    const signal = new AbortController().signal;
    const progress = vi.fn();
    const options = {
      unit: "cm" as const,
      signal,
      onProgress: progress,
      ...(placeAtOrigin === undefined ? {} : { placeAtOrigin }),
    };
    const entity = await imported.prepareImportedScan(file, options);
    const [actualFile, forwarded] = vi.mocked(importScan).mock.calls[0];
    expect(actualFile).toBe(file);
    expect(forwarded).toMatchObject({
      unit: "cm",
      signal,
      placeAtOrigin: placeAtOrigin ?? false,
    });
    expect(forwarded?.onProgress).toBe(progress);
    expect(entity.positions).toBe(
      await vi.mocked(importScan).mock.results[0].value,
    );
    expect(entity.kind).toBe(format === "asc" ? "pointcloud" : "mesh");
    // Parsing/unit/origin arithmetic is exercised independently by import-origin tests.
    expect(Array.from(entity.positions)).toEqual([
      20, 30, 40, 21, 30, 40, 20, 31, 40,
    ]);
    if (placeAtOrigin === undefined)
      expect(options).not.toHaveProperty("placeAtOrigin");
    else expect(options.placeAtOrigin).toBe(placeAtOrigin);
  },
);

function setup(importPlaceAtOrigin = false) {
  const state: WorkspaceSnapshot = {
    name: "Placement",
    entities: [],
    history: [],
    future: [],
    authoring: {},
    selectedId: null,
    selection: null,
    settings: { importPlaceAtOrigin },
  };
  let busy = false;
  const host: WorkspaceHost = {
    snapshot: () => ({ ...state }),
    cad: () => {
      throw Error("CAD is outside this scan-import regression");
    },
    commit: (entities, label) => {
      state.history = [...state.history, { entities: state.entities, label }];
      state.entities = entities;
      state.future = [];
    },
    replace: (project) => {
      state.entities = project.entities;
    },
    select: (id) => {
      state.selectedId = id;
    },
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn((patch) => {
      state.settings = { ...state.settings, ...patch };
    }),
    busy: () => busy,
    activity: (value) => {
      busy = value;
    },
    present: async () => {},
  };
  const api = new ApplicationApi(host, createOperations(host));
  apis.push(api);
  return { api, state };
}

async function upload(api: ApplicationApi, format: string) {
  const wire = await api.invoke("artifact_put", {
    name: `offset.${format}`,
    offset: 0,
    base64: Buffer.from("parser-is-mocked").toString("base64"),
  });
  expect(wire.ok).toBe(true);
  if (!wire.ok) throw Error(wire.error.message);
  return (wire.result as { artifactId: string }).artifactId;
}
async function terminal(api: ApplicationApi, jobId: string) {
  for (let n = 0; n < 100; n++) {
    const wire = await api.invoke("job_get", { jobId });
    expect(wire.ok).toBe(true);
    if (!wire.ok) throw Error(wire.error.message);
    const result = wire.result as {
      status: string;
      result?: unknown;
      error?: unknown;
    };
    if (result.status !== "running") return result;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw Error("Small mocked import job did not settle");
}

it.each(cases)(
  "MCP single $format/$placeAtOrigin forwards placement once through a retry-safe job",
  async ({ format, placeAtOrigin }) => {
    const { api, state } = setup();
    const artifactId = await upload(api, format);
    const request = {
      artifactId,
      unit: "cm",
      expectedRevision: api.currentRevision(),
      requestId: "single-import",
      ...(placeAtOrigin === undefined ? {} : { placeAtOrigin }),
    };
    const submitted = await api.invoke("project_import", request);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) throw Error(submitted.error.message);
    const done = await terminal(
      api,
      (submitted.result as { jobId: string }).jobId,
    );
    expect(done.status).toBe("succeeded");
    expect(state.entities).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    expect(vi.mocked(importScan)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(importScan).mock.calls[0][1]).toMatchObject({
      unit: "cm",
      placeAtOrigin: placeAtOrigin ?? false,
    });
    expect(await api.invoke("project_import", request)).toEqual(submitted);
    expect(vi.mocked(importScan)).toHaveBeenCalledTimes(1);
    expect(state.history).toHaveLength(1);
    const conflict = await api.invoke("project_import", {
      ...request,
      placeAtOrigin: !(placeAtOrigin ?? false),
    });
    expect(conflict.ok).toBe(false);
    expect(state.history).toHaveLength(1);
  },
);

it.each(placements)(
  "MCP batch forwards placement=%s to every format and retains per-file commits",
  async (placeAtOrigin) => {
    const { api, state } = setup();
    const artifactIds = [];
    for (const format of formats) artifactIds.push(await upload(api, format));
    const request = {
      artifactIds,
      unit: "cm",
      expectedRevision: api.currentRevision(),
      requestId: "batch-import",
      ...(placeAtOrigin === undefined ? {} : { placeAtOrigin }),
    };
    const submitted = await api.invoke("project_import_batch", request);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) throw Error(submitted.error.message);
    const done = await terminal(
      api,
      (submitted.result as { jobId: string }).jobId,
    );
    expect(done).toMatchObject({
      status: "succeeded",
      result: { failed: [], cancelled: false },
    });
    expect(state.entities.map((entity) => entity.name)).toEqual(
      formats.map((format) => `offset.${format}`),
    );
    expect(state.history).toHaveLength(3);
    expect(vi.mocked(importScan)).toHaveBeenCalledTimes(3);
    for (const [, options] of vi.mocked(importScan).mock.calls)
      expect(options).toMatchObject({
        unit: "cm",
        placeAtOrigin: placeAtOrigin ?? false,
      });
    expect(await api.invoke("project_import_batch", request)).toEqual(
      submitted,
    );
    expect(state.history).toHaveLength(3);
    expect(vi.mocked(importScan)).toHaveBeenCalledTimes(3);
  },
);

it.each(["project_import", "project_import_batch"])(
  "discovers optional boolean placement and rejects invalid %s placement before work",
  async (command) => {
    const tool = catalog.find((tool) => tool.name === command)!;
    expect(tool.inputSchema.properties).toMatchObject({
      placeAtOrigin: { type: "boolean" },
    });
    expect(tool.inputSchema.required).not.toContain("placeAtOrigin");
    const { api, state } = setup();
    const artifactId = await upload(api, "ply");
    const base = {
      ...(command === "project_import"
        ? { artifactId }
        : { artifactIds: [artifactId] }),
      expectedRevision: api.currentRevision(),
      requestId: "schema-check",
    };
    for (const placeAtOrigin of [undefined, false, true])
      expect(() =>
        validateInput(tool.inputSchema, {
          ...base,
          ...(placeAtOrigin === undefined ? {} : { placeAtOrigin }),
        }),
      ).not.toThrow();
    for (const placeAtOrigin of ["true", 1, null]) {
      expect(() =>
        validateInput(tool.inputSchema, { ...base, placeAtOrigin }),
      ).toThrow();
      expect((await api.invoke(command, { ...base, placeAtOrigin })).ok).toBe(
        false,
      );
    }
    expect(vi.mocked(importScan)).not.toHaveBeenCalled();
    expect(state.entities).toHaveLength(0);
    expect(state.history).toHaveLength(0);
    expect((await api.invoke("session_get", {})).ok).toBe(true);
  },
);

it("discovers and round-trips the workspace import preference without model history", async () => {
  const tool = catalog.find((tool) => tool.name === "settings_set")!;
  expect(tool.inputSchema.properties!.patch!.properties).toMatchObject({
    importPlaceAtOrigin: { type: "boolean" },
  });
  const { api, state } = setup();
  const before = await api.invoke("project_get", {});
  expect(before).toMatchObject({
    ok: true,
    result: { settings: { importPlaceAtOrigin: false } },
  });
  const revision = api.currentRevision();
  const request = {
    patch: { importPlaceAtOrigin: true },
    expectedRevision: revision,
    requestId: "placement-setting",
  };
  const changed = await api.invoke("settings_set", request);
  expect(changed.ok).toBe(true);
  expect(api.currentRevision()).toBeGreaterThan(revision);
  expect(await api.invoke("project_get", {})).toMatchObject({
    ok: true,
    result: { settings: { importPlaceAtOrigin: true } },
  });
  expect(await api.invoke("settings_set", request)).toEqual(changed);
  expect(
    (
      await api.invoke("settings_set", {
        ...request,
        patch: { importPlaceAtOrigin: false },
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await api.invoke("settings_set", {
        patch: { importPlaceAtOrigin: false },
        expectedRevision: revision,
        requestId: "stale-setting",
      })
    ).ok,
  ).toBe(false);
  expect(state.settings.importPlaceAtOrigin).toBe(true);
  expect(state.history).toHaveLength(0);
  expect(state.future).toHaveLength(0);
  expect(vi.mocked(importScan)).not.toHaveBeenCalled();
});

it("rejects nonboolean workspace placement settings atomically and permits a corrected retry", async () => {
  const { api, state } = setup();
  for (const value of ["true", 1, null]) {
    expect(
      (
        await api.invoke("settings_set", {
          patch: { importPlaceAtOrigin: value },
          expectedRevision: api.currentRevision(),
          requestId: `bad-${value}`,
        })
      ).ok,
    ).toBe(false);
    expect(state.settings.importPlaceAtOrigin).toBe(false);
  }
  expect(
    (
      await api.invoke("settings_set", {
        patch: { importPlaceAtOrigin: true },
        expectedRevision: api.currentRevision(),
        requestId: "corrected",
      })
    ).ok,
  ).toBe(true);
  expect(state.settings.importPlaceAtOrigin).toBe(true);
  expect(state.history).toHaveLength(0);
});

it.each(["project_import", "project_import_batch"])(
  "%s captures the workspace placement preference and honors explicit overrides without changing it",
  async (command) => {
    for (const preference of [false, true]) {
      for (const override of placements) {
        vi.mocked(importScan).mockClear();
        const { api, state } = setup(preference);
        const artifactId = await upload(api, "ply");
        const secondArtifactId =
          command === "project_import_batch"
            ? await upload(api, "asc")
            : undefined;
        const request = {
          ...(command === "project_import"
            ? { artifactId }
            : { artifactIds: [artifactId, secondArtifactId] }),
          expectedRevision: api.currentRevision(),
          requestId: `inherit-${preference}-${override}`,
          ...(override === undefined ? {} : { placeAtOrigin: override }),
        };
        const submitted = await api.invoke(command, request);
        expect(submitted.ok).toBe(true);
        if (!submitted.ok) throw Error(submitted.error.message);
        const done = await terminal(
          api,
          (submitted.result as { jobId: string }).jobId,
        );
        expect(done.status).toBe("succeeded");
        const count = command === "project_import" ? 1 : 2;
        expect(vi.mocked(importScan)).toHaveBeenCalledTimes(count);
        for (const [, options] of vi.mocked(importScan).mock.calls)
          expect(options?.placeAtOrigin).toBe(override ?? preference);
        expect(state.settings.importPlaceAtOrigin).toBe(preference);
        expect(state.history).toHaveLength(count);
        expect(await api.invoke(command, request)).toEqual(submitted);
        expect(vi.mocked(importScan)).toHaveBeenCalledTimes(count);
      }
    }
  },
);
