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
import { createScanSelectionOperations } from "../src/automation/scan-selection-operations";
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
    ...createScanSelectionOperations(host),
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
  it("exposes landmark session edits with revision and retry protection and read-only observation", async () => {
    const { api, host } = setup();
    host.inspectLandmarks = () => ({ active: true, preview: false });
    host.editLandmarks = vi.fn((edit) => ({
      active: true,
      action: edit.action,
    }));
    const request = { action: "reset", ...mutation(api, "landmark-reset") };
    expect((await api.invoke("landmark_get", {})).ok).toBe(true);
    const first = await api.invoke("landmark_edit", request);
    expect(first.ok).toBe(true);
    expect(await api.invoke("landmark_edit", request)).toEqual(first);
    expect(host.editLandmarks).toHaveBeenCalledTimes(1);
    expect(
      (await api.invoke("landmark_edit", { ...request, action: "clear" })).ok,
    ).toBe(false);
    expect(
      (
        await api.invoke("landmark_edit", {
          ...request,
          expectedRevision: 999,
          requestId: "stale",
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await api.invoke("landmark_edit", {
          ...request,
          action: "unknown",
          requestId: "invalid",
        })
      ).ok,
    ).toBe(false);
    api.dispose();
  });
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

it("selects through the shared operation without busy UI commits and keeps revision/retry checks", async () => {
  const { api, host, state } = setup();
  state.selectedId = "previous";
  const activity = vi.spyOn(host, "activity");
  const select = vi.spyOn(host, "select");
  const request = mutation(api, "quiet-selection");
  const first = await api.invoke("object_select", request);
  expect(first).toMatchObject({
    ok: true,
    result: { entityId: null, selectedIds: [] },
  });
  expect(await api.invoke("object_select", request)).toEqual(first);
  expect(select).toHaveBeenCalledTimes(1);
  expect(activity).not.toHaveBeenCalled();
  expect(
    await api.invoke("object_select", {
      ...mutation(api, "stale-selection"),
      expectedRevision: 999,
    }),
  ).toMatchObject({ ok: false });
  expect(select).toHaveBeenCalledTimes(1);
  api.dispose();
});

it("keeps selection inside the admission lane even without host busy toggles", async () => {
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const { api, host } = setup({
    object_select: () => held,
    settings_set: () => ({ changed: true }),
  });
  const activity = vi.spyOn(host, "activity");
  const selecting = api.invoke(
    "object_select",
    mutation(api, "held-selection"),
  );
  expect(
    await api.invoke("settings_set", {
      ...mutation(api, "blocked-setting"),
      patch: {},
    }),
  ).toMatchObject({ ok: false, error: { code: "BUSY" } });
  expect(activity).not.toHaveBeenCalled();
  finish();
  expect((await selecting).ok).toBe(true);
  api.dispose();
});

describe("published sketch-section options", () => {
  const schema = catalog.find(
    (command) => command.name === "mesh_process",
  )!.inputSchema;
  const options = {
    plane: "OXY",
    offset: 1,
    onSlicingPlane: true,
    selectedOnly: true,
  };
  const args = (value: unknown) => ({
    entityId: "mesh",
    expectedRevision: 0,
    requestId: "section-schema",
    operation: { kind: "sketchSection", options: value },
  });
  it.each(["OXY", "OYZ", "OXZ"])(
    "accepts the actual GUI section options for %s",
    (plane) => {
      expect(() =>
        validateInput(schema, args({ ...options, plane })),
      ).not.toThrow();
    },
  );
  it.each(["plane", "offset", "onSlicingPlane", "selectedOnly"])(
    "requires the explicit GUI option %s",
    (key) => {
      const incomplete: Record<string, unknown> = { ...options };
      delete incomplete[key];
      expect(() => validateInput(schema, args(incomplete))).toThrow();
    },
  );
  it.each([
    { ...options, plane: "XY" },
    { ...options, offset: NaN },
    { ...options, offset: Infinity },
    { ...options, selectedOnly: "true" },
    { ...options, onSlicingPlane: 1 },
    { ...options, frame: {} },
    { ...options, tolerance: 0.1 },
    { ...options, chordTolerance: 0.1 },
  ])("rejects unsupported fields and invalid option values: %j", (invalid) => {
    expect(() => validateInput(schema, args(invalid))).toThrow();
  });
});

it("exposes stored computed facet carriers through actual object_get and geometry digest API jobs", async () => {
  const { api, state } = setup();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  state.entities = [
    {
      id: "facets",
      name: "Facets",
      kind: "mesh",
      color: "#888888",
      opacity: 1,
      visible: true,
      positions,
      indexedMesh: {
        vertices: positions,
        triangles: new Uint32Array([0, 1, 2]),
        facetNormals: new Float32Array([-0, 0.6, 0.8]),
      },
    },
  ];
  try {
    const inspected = await api.invoke("object_get", {
      entityId: "facets",
      includeGeometry: true,
    });
    expect(inspected.ok).toBe(true);
    const artifactId = (inspected as any).result.geometry.artifactId;
    const artifact = await api.invoke("artifact_read", { artifactId });
    const geometry = JSON.parse(atob((artifact as any).result.base64));
    expect(geometry.indexedMesh.facetNormals).toEqual([
      0,
      Math.fround(0.6),
      Math.fround(0.8),
    ]);
    const job = await api.invoke("object_geometry_digest", {
      entityId: "facets",
    });
    const jobId = (job as any).result.jobId;
    let receipt: any;
    await vi.waitFor(async () => {
      receipt = await api.invoke("job_get", { jobId });
      expect(receipt.result.status).toBe("succeeded");
    });
    expect(
      receipt.result.result.buffers.find(
        (b: any) => b.path === "indexedMesh.facetNormals",
      ),
    ).toMatchObject({ encoding: "f32", elements: 3, rawBytes: 12 });
    expect(state.history).toHaveLength(0);
  } finally {
    api.dispose();
  }
});
it("rejects oversized geometry JSON including its facet carrier before expanding any coordinates", async () => {
  const { api, state } = setup();
  const facetNormals = new Proxy(new Array(600_000_000), {
    get(target, key, receiver) {
      if (key === "0") throw Error("must reject before coordinate expansion");
      return Reflect.get(target, key, receiver);
    },
  });
  state.entities = [
    {
      id: "large",
      name: "Large",
      kind: "mesh",
      color: "#888888",
      opacity: 1,
      visible: true,
      positions: [],
      indexedMesh: { vertices: [], triangles: [], facetNormals },
    },
  ];
  try {
    expect(
      await api.invoke("object_get", {
        entityId: "large",
        includeGeometry: true,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "RESOURCE_LIMIT",
        message: expect.stringContaining("1 GiB"),
      },
    });
  } finally {
    api.dispose();
  }
});

it("preserves the established typed edgePositions JSON object representation", async () => {
  const { api, state } = setup();
  state.entities = [
    {
      id: "edges",
      name: "Edges",
      kind: "mesh",
      color: "#888888",
      opacity: 1,
      visible: true,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      // Preserve the runtime JSON shape of legacy typed metadata.
      edgePositions: new Float32Array([
        1, 2, 3, 4, 5, 6,
      ]) as unknown as number[],
    },
  ];
  try {
    const response: any = await api.invoke("object_get", {
      entityId: "edges",
      includeGeometry: true,
    });
    const read: any = await api.invoke("artifact_read", {
      artifactId: response.result.geometry.artifactId,
    });
    expect(JSON.parse(atob(read.result.base64)).edgePositions).toEqual({
      0: 1,
      1: 2,
      2: 3,
      3: 4,
      4: 5,
      5: 6,
    });
  } finally {
    api.dispose();
  }
});

describe("M6 inspection API", () => {
  it("exposes all measurement kinds with schema and domain validation", async () => {
    const { api, state } = setup();
    try {
      const base = { first: [1, 0, 0], second: [0, 0, 0], third: [0, 1, 0] };
      expect(
        await api.invoke("analysis_measure", { ...base, kind: "angle" }),
      ).toMatchObject({ ok: true, result: { angle: 90, units: "deg" } });
      expect(
        await api.invoke("analysis_measure", {
          first: [0, 0, 0],
          second: [3, 4, 0],
        }),
      ).toMatchObject({ ok: true, result: { distance: 5, units: "mm" } });
      for (const kind of ["radius", "diameter"])
        expect(
          await api.invoke("analysis_measure", {
            ...base,
            kind,
            second: [0, 1, 0],
            third: [-1, 0, 0],
          }),
        ).toMatchObject({ ok: true, result: { radius: 1, diameter: 2 } });
      expect(
        await api.invoke("analysis_measure", {
          ...base,
          kind: "angle",
          third: undefined,
        }),
      ).toMatchObject({ ok: false });
      expect(
        await api.invoke("analysis_measure", {
          ...base,
          kind: "radius",
          third: [2, 0, 0],
        }),
      ).toMatchObject({ ok: false });
      expect(state.history).toEqual([]);
    } finally {
      api.dispose();
    }
  });
  it("publishes reproducible signed reports and visible-face sections without changing geometry or history", async () => {
    const { api, state } = setup();
    const positions = new Float32Array([
      0, 0, -2, 4, 0, -2, 0, 3, -2, 0, 0, 2, 4, 0, 2, 0, 3, 2,
    ]);
    state.entities = [
      {
        id: "scan",
        kind: "mesh",
        name: "scan",
        positions,
        color: "#fff",
        visible: true,
        opacity: 1,
        meshSelection: { hidden: [0], saved: [] },
      },
    ];
    async function job(name: string, args: Record<string, unknown>) {
      const receipt = (await api.invoke(name, args)) as any;
      expect(receipt.ok).toBe(true);
      for (let i = 0; i < 100; i++) {
        const info = (await api.invoke("job_get", {
          jobId: receipt.result.jobId,
        })) as any;
        if (info.result.status !== "running") {
          expect(info.result.status).toBe("succeeded");
          return info.result.result;
        }
        await new Promise((r) => setTimeout(r, 1));
      }
      throw Error("inspection job did not settle");
    }
    try {
      const fit = {
        kind: "plane",
        center: [0, 0, 0],
        axis: [0, 0, 1],
        rms: 0,
        maxError: 0,
      };
      const result = await job("analysis_deviation", {
        entityId: "scan",
        fit,
        tolerance: 1,
      });
      expect(result).toMatchObject({
        rms: 2,
        mean: 2,
        minimum: 2,
        maximum: 2,
        samples: 3,
        excluded: 3,
        withinTolerance: 0,
        units: "mm",
        fit,
        tolerance: 1,
      });
      const section = await job("analysis_section", {
        entityId: "scan",
        axis: "x",
        offset: 2,
      });
      expect(section).toMatchObject({
        length: 1.5,
        segments: 1,
        units: "mm",
        scope: "visible-triangles",
      });
      expect(state.entities[0].positions).toBe(positions);
      expect(api.currentRevision()).toBe(0);
      expect(state.history).toEqual([]);
    } finally {
      api.dispose();
    }
  });
});

describe("inspection heatmap access and lifecycle", () => {
  it("shows the shared report through MCP, rejects stale geometry, and clears on disposal", async () => {
    const { api, state, host } = setup();
    const source = {
      id: "source",
      kind: "pointcloud" as const,
      name: "source",
      positions: new Float32Array([1, 1, -1, 1, 1, 1]),
      color: "#fff",
      visible: true,
      opacity: 1,
    };
    const reference = {
      ...source,
      id: "target",
      kind: "mesh" as const,
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
    };
    state.entities = [source, reference];
    state.selectedId = source.id;
    host.showInspection = vi.fn();
    try {
      const receipt = (await api.invoke("analysis_deviation", {
        entityId: "source",
        referenceId: "target",
        maxDistance: 2,
        signed: true,
        tolerance: 1,
      })) as any;
      expect(receipt.ok).toBe(true);
      let report: any;
      for (let i = 0; i < 100; i++) {
        const response = (await api.invoke("job_get", {
          jobId: receipt.result.jobId,
        })) as any;
        if (response.result.status !== "running") {
          expect(response.result.status).toBe("succeeded");
          report = response.result.result;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(report).toMatchObject({
        samples: 2,
        minimum: -1,
        maximum: 1,
        rms: 1,
        coverage: 1,
      });
      expect(report.referenceTriangles).toBeUndefined();
      expect(
        await api.invoke("inspection_display", {
          action: "show",
          inspectionId: report.inspectionId,
          ...mutation(api, "show-inspection"),
        }),
      ).toMatchObject({ ok: true, result: { displayed: true } });
      expect(host.showInspection).toHaveBeenLastCalledWith(
        expect.objectContaining({
          source,
          reference,
          report: expect.objectContaining({ distances: [-1, 1] }),
        }),
      );
      expect(state.history).toEqual([]);
      state.entities = [
        { ...source, positions: new Float32Array([1, 1, 3, 1, 1, 4]) },
        reference,
      ];
      expect(
        await api.invoke("inspection_display", {
          action: "show",
          inspectionId: report.inspectionId,
          ...mutation(api, "stale-inspection"),
        }),
      ).toMatchObject({ ok: false });
      expect(host.showInspection).toHaveBeenLastCalledWith(null);
    } finally {
      api.dispose();
      expect(host.showInspection).toHaveBeenLastCalledWith(null);
    }
  });
  it("cancels primitive analysis between chunks without publishing artifacts or changing history", async () => {
    const { api, state } = setup();
    state.entities = [
      {
        id: "source",
        kind: "pointcloud",
        name: "source",
        positions: new Float32Array(30000).fill(1),
        color: "#fff",
        visible: true,
        opacity: 1,
      },
    ];
    try {
      const receipt = (await api.invoke("analysis_deviation", {
        entityId: "source",
        fit: {
          kind: "plane",
          center: [0, 0, 0],
          axis: [0, 0, 1],
          rms: 0,
          maxError: 0,
        },
      })) as any;
      await api.invoke("job_cancel", { jobId: receipt.result.jobId });
      let terminal: any;
      for (let i = 0; i < 100; i++) {
        terminal = (await api.invoke("job_get", {
          jobId: receipt.result.jobId,
        })) as any;
        if (terminal.result.status !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(terminal.result.status).toBe("cancelled");
      expect(await api.invoke("session_get", {})).toMatchObject({
        ok: true,
        result: { artifacts: [] },
      });
      expect(state.history).toEqual([]);
    } finally {
      api.dispose();
    }
  });
});

it("saves and replays project-persistent inspection definitions with guarded edits and unchanged model history", async () => {
  const { api, host, state } = setup();
  host.setAuthoring = (authoring) => {
    state.authoring = authoring;
  };
  try {
    const definition = {
      kind: "measurement",
      measurement: { kind: "distance", first: [0, 0, 0], second: [3, 4, 0] },
    };
    const saved = (await api.invoke("inspection_manage", {
      action: "save",
      name: "Five millimetres",
      definition,
      ...mutation(api, "save-five"),
    })) as any;
    expect(saved.ok).toBe(true);
    expect(state.authoring.inspections).toHaveLength(1);
    expect(await api.invoke("inspection_get", {})).toMatchObject({
      ok: true,
      result: {
        inspections: [
          {
            id: saved.result.inspectionId,
            name: "Five millimetres",
            definition,
          },
        ],
      },
    });
    const receipt = (await api.invoke("inspection_run", {
      inspectionId: saved.result.inspectionId,
    })) as any;
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(
      await api.invoke("job_get", { jobId: receipt.result.jobId }),
    ).toMatchObject({
      ok: true,
      result: { status: "succeeded", result: { distance: 5, units: "mm" } },
    });
    expect(
      await api.invoke("inspection_manage", {
        action: "delete",
        inspectionId: saved.result.inspectionId,
        ...mutation(api, "delete-five"),
      }),
    ).toMatchObject({ ok: true });
    expect(state.authoring.inspections).toEqual([]);
    expect(state.history).toEqual([]);
  } finally {
    api.dispose();
  }
});
it("publishes only top-level object schemas accepted by the official MCP SDK", () => {
  for (const command of catalog)
    expect(command.inputSchema.type, command.name).toBe("object");
});

it("releases partially created result artifacts when report publication exceeds the artifact count limit", async () => {
  const { api, state } = setup();
  state.entities = [
    {
      id: "source",
      kind: "pointcloud",
      name: "source",
      positions: new Float32Array([0, 0, 1]),
      color: "#fff",
      visible: true,
      opacity: 1,
    },
  ];
  try {
    for (let i = 0; i < 63; i++)
      expect(
        await api.invoke("artifact_put", {
          name: "fixture-" + i,
          offset: 0,
          base64: "eA==",
        }),
      ).toMatchObject({ ok: true });
    const receipt = (await api.invoke("analysis_deviation", {
      entityId: "source",
      fit: {
        kind: "plane",
        center: [0, 0, 0],
        axis: [0, 0, 1],
        rms: 0,
        maxError: 0,
      },
    })) as any;
    let terminal: any;
    for (let i = 0; i < 100; i++) {
      terminal = (await api.invoke("job_get", {
        jobId: receipt.result.jobId,
      })) as any;
      if (terminal.result.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(terminal.result.status).toBe("failed");
    const session = (await api.invoke("session_get", {})) as any;
    expect(session.result.artifacts).toHaveLength(63);
  } finally {
    api.dispose();
  }
});

it("exposes the measurement overlay and visible section plane through guarded MCP display actions", async () => {
  const { api, host, state } = setup();
  host.showMeasurement = vi.fn();
  host.showSection = vi.fn();
  state.entities = [
    {
      id: "source",
      kind: "mesh",
      name: "source",
      positions: new Float32Array([0, 0, 0, 4, 0, 0, 0, 3, 0]),
      color: "#fff",
      visible: true,
      opacity: 1,
    },
  ];
  state.selectedId = "source";
  try {
    const measurement = { first: [0, 0, 0], second: [3, 4, 0] };
    expect(
      await api.invoke("inspection_display", {
        action: "measurement",
        measurement,
        ...mutation(api, "show-measurement"),
      }),
    ).toMatchObject({ ok: true, result: { distance: 5, units: "mm" } });
    expect(host.showMeasurement).toHaveBeenLastCalledWith(measurement);
    expect(
      await api.invoke("inspection_display", {
        action: "section",
        entityId: "source",
        axis: "x",
        offset: 2,
        ...mutation(api, "show-section"),
      }),
    ).toMatchObject({ ok: true, result: { length: 1.5, segments: 1 } });
    expect(host.showSection).toHaveBeenLastCalledWith({
      entityId: "source",
      axis: "x",
      offset: 2,
    });
    expect(
      await api.invoke("inspection_display", {
        action: "clear",
        ...mutation(api, "clear-inspection"),
      }),
    ).toMatchObject({ ok: true });
    expect(host.showMeasurement).toHaveBeenLastCalledWith(null);
    expect(host.showSection).toHaveBeenLastCalledWith(null);
    expect(state.history).toEqual([]);
  } finally {
    api.dispose();
  }
});
