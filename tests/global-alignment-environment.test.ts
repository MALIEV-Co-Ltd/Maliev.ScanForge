import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type ApiResult,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createGlobalAlignmentOperations } from "../src/automation/global-alignment-operations";
import type { GlobalSceneInput } from "../src/scan-global-scene-core";
import type { Entity } from "../src/types";

// Exercise the real public gateway and shared handler; these two seams do not
// establish native, real-worker or rendered acceptance.
const solver = vi.hoisted(() => ({ prepare: vi.fn(), refine: vi.fn() }));
vi.mock("../src/global-alignment-input", async (original) => ({
  ...(await original<typeof import("../src/global-alignment-input")>()),
  prepareGlobalAlignmentInput: solver.prepare,
}));
vi.mock("../src/scan-global-registration", () => ({
  refineGlobalScanSet: solver.refine,
}));

type Environment = {
  sceneClocks?: ReadonlyMap<string, readonly number[]>;
  clock?: () => number;
};
const apis: ApplicationApi[] = [];
function value<T>(response: ApiResult): T {
  expect(response.ok).toBe(true);
  if (!response.ok) throw Error(response.error.message);
  return response.result as T;
}
function setup(environment?: Environment) {
  const entities: Entity[] = ["a", "b"].map((id) => ({
    id,
    name: id,
    kind: "mesh",
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    visible: true,
    color: "#aaa",
    opacity: 1,
  }));
  const state: WorkspaceSnapshot = {
    name: "Environmental clock contract",
    entities,
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
      throw Error("No CAD in clock contract test.");
    },
    commit: vi.fn((output, label) => {
      state.history = [...state.history, { entities: state.entities, label }];
      state.entities = output;
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
    activity: (running) => {
      busy = running;
    },
    showDatumPreview: vi.fn(),
    setInterface: vi.fn(),
    inspectApplication: () => ({ previews: {} }),
  };
  const input: GlobalSceneInput = {
    scans: entities.map((e) => ({
      id: e.id,
      geometry: {
        points: e.positions as Float32Array,
        normals: new Float32Array(9),
      },
    })),
    radius: 0.5,
    spacing: 12,
    budget: 1000,
    mask: 0,
  };
  const release = vi.fn();
  solver.prepare.mockResolvedValue({
    input,
    entities,
    summary: { scanCount: 2 },
    release,
  });
  const output = entities.map((e) => ({
    ...e,
    positions: e.positions.slice(),
  }));
  solver.refine.mockImplementation(async (_input, _entities, options) => {
    const seed = options.clock?.() ?? 123;
    return {
      entities: output,
      outer: {
        applications: [],
        passes: 2,
        order: ["a", "b"],
        seed,
        states: [],
      },
      diagnostics: { queries: 45, localResults: [] },
    };
  });
  const api = new ApplicationApi(
    host,
    createGlobalAlignmentOperations(host, environment),
  );
  apis.push(api);
  let request = 0;
  const mutation = () => ({
    expectedRevision: api.currentRevision(),
    requestId: `clock-${++request}`,
  });
  const preview = async (args: Record<string, unknown> = {}) => {
    const { jobId } = value<{ jobId: string }>(
      await api.invoke("global_alignment_preview", { ...mutation(), ...args }),
    );
    await vi.waitFor(async () => {
      const job = value<{ status: string }>(
        await api.invoke("job_get", { jobId }),
      );
      expect(job.status).not.toBe("running");
    });
    return value<{ status: string; error?: { message: string } }>(
      await api.invoke("job_get", { jobId }),
    );
  };
  return {
    api,
    state,
    host,
    input,
    entities,
    output,
    release,
    mutation,
    preview,
  };
}
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
});

it("preserves the normal packet and solver options without an environment", async () => {
  const h = setup();
  expect((await h.preview()).status).toBe("succeeded");
  expect(solver.refine.mock.calls[0][0]).toBe(h.input);
  expect(h.input).not.toHaveProperty("clocks");
  expect(solver.refine.mock.calls[0][2]).not.toHaveProperty("clock");
  expect(h.release).toHaveBeenCalledTimes(1);
});

it("copies clocks by prepared scan ID order, forwards the outer clock and applies the cached output once", async () => {
  const a = [1, -2],
    b = [0xffffffff];
  const clock = vi.fn(() => 424242);
  const h = setup({
    sceneClocks: new Map([
      ["b", b],
      ["a", a],
    ]),
    clock,
  });
  expect((await h.preview()).status).toBe("succeeded");
  expect(h.input.clocks).toEqual([a, b]);
  expect(h.input.clocks![0]).not.toBe(a);
  expect(h.input.clocks![1]).not.toBe(b);
  a[0] = 99;
  expect(h.input.clocks![0][0]).toBe(1);
  expect(solver.refine.mock.calls[0][2].clock).toBe(clock);
  expect(clock).toHaveBeenCalledTimes(1);
  const preview = value<{ previewId: string; outer: { seed: number } }>(
    await h.api.invoke("global_alignment_state", {}),
  );
  expect(preview.outer.seed).toBe(424242);
  expect(h.host.commit).not.toHaveBeenCalled();
  const args = { ...h.mutation(), previewId: preview.previewId };
  expect(await h.api.invoke("global_alignment_apply", args)).toMatchObject({
    ok: true,
    result: { applied: true },
  });
  expect(await h.api.invoke("global_alignment_apply", args)).toMatchObject({
    ok: true,
  });
  h.state.entities.forEach((entity, i) => expect(entity).toBe(h.output[i]));
  expect(h.state.history).toHaveLength(1);
  expect(solver.refine).toHaveBeenCalledTimes(1);
  expect(clock).toHaveBeenCalledTimes(1);
  expect(h.release).toHaveBeenCalledTimes(1);
});

it.each([
  ["missing", new Map([["a", [1]]])],
  [
    "nonfinite",
    new Map([
      ["a", [1]],
      ["b", [NaN]],
    ]),
  ],
  [
    "fractional",
    new Map([
      ["a", [1]],
      ["b", [0.5]],
    ]),
  ],
  [
    "out of range",
    new Map([
      ["a", [1]],
      ["b", [0x100000000]],
    ]),
  ],
] as const)(
  "rejects %s source clocks atomically and releases prepared inputs",
  async (_name, sceneClocks) => {
    const h = setup({ sceneClocks });
    const job = await h.preview();
    expect(job.status).toBe("failed");
    expect(job.error?.message).toMatch(/clock/i);
    expect(h.input).not.toHaveProperty("clocks");
    expect(solver.refine).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.host.showDatumPreview).not.toHaveBeenCalled();
    expect(h.host.commit).not.toHaveBeenCalled();
    expect(h.state.entities).toBe(h.entities);
    expect(h.state.history).toHaveLength(0);
    expect(await h.api.invoke("global_alignment_state", {})).toMatchObject({
      ok: true,
      result: { state: "idle" },
    });
  },
);

it.each(["locked", "missing"])(
  "rejects %s sources before reading the environment",
  async (kind) => {
    const read = vi.fn(() => {
      throw Error("Environment must not be read.");
    });
    const environment = Object.defineProperty({}, "sceneClocks", { get: read });
    const h = setup(environment);
    if (kind === "locked") h.entities[0].locked = true;
    const job = await h.preview(
      kind === "missing" ? { entityIds: ["a", "missing"] } : {},
    );
    expect(job.status).toBe("failed");
    expect(read).not.toHaveBeenCalled();
    expect(solver.prepare).not.toHaveBeenCalled();
    expect(solver.refine).not.toHaveBeenCalled();
  },
);
