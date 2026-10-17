import { beforeEach, expect, it, vi } from "vitest";
import { createSurfaceFitOperation } from "../src/automation/surface-fit-operations";
import {
  ApplicationApi,
  type CommandContext,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { CadClient } from "../src/cad/client";
import { beginSurfaceFit, surfaceFitEntity } from "../src/surface-fit-session";
import { fitGridSurfaceAsync } from "../src/surface-client";
import { createGridPatch } from "../src/surfaces";
vi.mock("../src/surface-client", () => ({ fitGridSurfaceAsync: vi.fn() }));
const preview = {
  patch: createGridPatch(4, 4),
  samples: 16,
  rms: 0,
  maxError: 0,
  projection: "xy" as const,
  solverBytes: 4096,
};
const options = { countU: 4, countV: 4, projection: "xy", sampleLimit: 100 };
beforeEach(() => {
  vi.mocked(fitGridSurfaceAsync).mockReset();
  vi.mocked(fitGridSurfaceAsync).mockResolvedValue(preview);
});
function setup() {
  const state: WorkspaceSnapshot = {
    name: "Test",
    entities: [
      {
        id: "scan",
        name: "Scan",
        kind: "mesh",
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 9, 0, 0, 10, 0, 0, 9, 1, 0],
        color: "#abc",
        visible: true,
        opacity: 1,
        meshSelection: { hidden: [1], saved: [] },
      },
    ],
    history: [],
    future: [],
    authoring: {},
    selectedId: "scan",
    selection: new Uint8Array([1, 1]),
    settings: {},
  };
  const commit = vi.fn((entities) => {
    state.entities = entities;
  });
  const host = {
    snapshot: () => state,
    commit,
    cad: () => ({}) as CadClient,
  } as unknown as WorkspaceHost;
  const context = {
    signal: new AbortController().signal,
    check: vi.fn(),
    progress: vi.fn(),
    mutate: vi.fn((write: () => void) => write()),
  } as unknown as CommandContext;
  return {
    state,
    host,
    context,
    commit,
    operation: createSurfaceFitOperation(host),
  };
}
it("fits exactly the GUI selected-visible input and shares accepted geometry", async () => {
  const h = setup(),
    source = h.state.entities[0];
  const session = beginSurfaceFit(
    source,
    h.state.selection,
    source.meshSelection!.hidden,
  );
  const result = (await h.operation(
    { entityId: source.id, selectionOnly: true, options },
    h.context,
  )) as { entityId: string };
  expect(fitGridSurfaceAsync).toHaveBeenCalledWith(
    session.scan,
    options,
    expect.objectContaining({ signal: h.context.signal }),
  );
  const expected = surfaceFitEntity({ ...session, preview }, result.entityId);
  expect(h.state.entities[1]).toMatchObject({
    ...expected,
    name: "Scan fitted surface",
    color: source.color,
  });
  expect(h.state.entities[0]).toBe(source);
  expect(h.commit).toHaveBeenCalledOnce();
  expect(h.context.mutate).toHaveBeenCalledOnce();
});
it("preserves whole-input default including point cloud support", async () => {
  const h = setup();
  h.state.entities[0].kind = "pointcloud";
  h.state.selectedId = null;
  const positions = h.state.entities[0].positions;
  await h.operation({ entityId: "scan", options }, h.context);
  expect(vi.mocked(fitGridSurfaceAsync).mock.calls[0][0]).toBe(positions);
});
it("rejects wrong-object, hidden-only and non-scan selections before starting a worker", async () => {
  for (const mode of ["wrong", "hidden", "patch"] as const) {
    const h = setup();
    if (mode === "wrong") h.state.selectedId = "other";
    if (mode === "hidden") h.state.selection = new Uint8Array([0, 1]);
    if (mode === "patch") h.state.entities[0].surfacePatch = preview.patch;
    await expect(
      h.operation(
        { entityId: "scan", selectionOnly: true, options },
        h.context,
      ),
    ).rejects.toThrow();
    expect(h.commit).not.toHaveBeenCalled();
  }
  expect(fitGridSurfaceAsync).not.toHaveBeenCalled();
});
it("rejects a stale source or cancelled context without committing", async () => {
  for (const cancelled of [false, true]) {
    const h = setup();
    vi.mocked(fitGridSurfaceAsync).mockImplementationOnce(async () => {
      if (cancelled)
        vi.mocked(h.context.check).mockImplementation(() => {
          throw new Error("Cancelled");
        });
      else
        h.state.entities = [
          {
            ...h.state.entities[0],
            positions: h.state.entities[0].positions.slice(),
          },
        ];
      return preview;
    });
    await expect(
      h.operation(
        { entityId: "scan", selectionOnly: true, options },
        h.context,
      ),
    ).rejects.toThrow(cancelled ? /Cancelled/ : /scan changed/);
    expect(h.commit).not.toHaveBeenCalled();
  }
});

it("dispatches selected-visible fitting through the published API schema and retry guards", async () => {
  const h = setup();
  let busy = false;
  h.host.busy = () => busy;
  h.host.activity = (running) => {
    busy = running;
  };
  const source = h.state.entities[0];
  const api = new ApplicationApi(h.host, createOperations(h.host));
  try {
    const request = {
      entityId: source.id,
      selectionOnly: true,
      options,
      expectedRevision: api.currentRevision(),
      requestId: "selected-visible-surface",
    };
    const response = await api.invoke("surface_fit", request);
    expect(response).toMatchObject({
      ok: true,
      result: { jobId: expect.any(String) },
    });
    const jobId = (response as { result: { jobId: string } }).result.jobId;
    await vi.waitFor(async () => {
      expect(await api.invoke("job_get", { jobId })).toMatchObject({
        ok: true,
        result: {
          status: "succeeded",
          result: { entityId: expect.any(String), samples: preview.samples },
        },
      });
    });
    expect(Array.from(vi.mocked(fitGridSurfaceAsync).mock.calls[0][0])).toEqual(
      Array.from(source.positions.slice(0, 9)),
    );
    expect(h.commit).toHaveBeenCalledOnce();
    expect(h.state.entities).toHaveLength(2);
    expect(h.state.entities[0]).toBe(source);
    expect(h.state.entities[1].surfaceScanId).toBe(source.id);
    expect(await api.invoke("surface_fit", request)).toEqual(response);
    expect(h.commit).toHaveBeenCalledOnce();
    expect(fitGridSurfaceAsync).toHaveBeenCalledOnce();
    expect(
      await api.invoke("surface_fit", { ...request, selectionOnly: false }),
    ).toMatchObject({ ok: false });
    expect(
      await api.invoke("surface_fit", {
        ...request,
        requestId: "stale-surface",
        expectedRevision: 999,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await api.invoke("surface_fit", {
        entityId: source.id,
        selectionOnly: true,
        options,
      }),
    ).toMatchObject({ ok: false });
    expect(h.commit).toHaveBeenCalledOnce();
  } finally {
    api.dispose();
  }
});

it("dispatches selected point-cloud samples through the published surface-fit API", async () => {
  const h = setup();
  h.state.entities[0].kind = "pointcloud";
  h.state.selection = new Uint8Array([1, 0, 0, 1, 0, 0]);
  h.host.busy = () => false;
  h.host.activity = vi.fn();
  const source = h.state.entities[0];
  const api = new ApplicationApi(h.host, createOperations(h.host));
  try {
    const request = {
      entityId: source.id,
      selectionOnly: true,
      options,
      expectedRevision: api.currentRevision(),
      requestId: "selected-point-surface",
    };
    const response = await api.invoke("surface_fit", request);
    expect(response).toMatchObject({
      ok: true,
      result: { jobId: expect.any(String) },
    });
    const jobId = (response as { result: { jobId: string } }).result.jobId;
    await vi.waitFor(async () => {
      expect(await api.invoke("job_get", { jobId })).toMatchObject({
        ok: true,
        result: { status: "succeeded" },
      });
    });
    expect(Array.from(vi.mocked(fitGridSurfaceAsync).mock.calls[0][0])).toEqual(
      [0, 0, 0, 9, 0, 0],
    );
    expect(h.state.entities[0]).toBe(source);
    expect(h.state.entities[1].surfaceScanId).toBe(source.id);
    expect(h.commit).toHaveBeenCalledOnce();
    expect(await api.invoke("surface_fit", request)).toEqual(response);
    expect(fitGridSurfaceAsync).toHaveBeenCalledOnce();
  } finally {
    api.dispose();
  }
});

it.each(["wrong", "missing", "mismatch", "binary", "empty"] as const)(
  "rejects %s point selection through the surface-fit API before worker creation",
  async (mode) => {
    const h = setup();
    h.state.entities[0].kind = "pointcloud";
    h.state.selection = new Uint8Array([1, 0, 0, 1, 0, 0]);
    if (mode === "wrong") h.state.selectedId = "other";
    if (mode === "missing") h.state.selection = null;
    if (mode === "mismatch") h.state.selection = new Uint8Array([1]);
    if (mode === "binary")
      h.state.selection = new Uint8Array([2, 0, 0, 1, 0, 0]);
    if (mode === "empty") h.state.selection = new Uint8Array(6);
    h.host.busy = () => false;
    h.host.activity = vi.fn();
    const api = new ApplicationApi(h.host, createOperations(h.host));
    try {
      const response = await api.invoke("surface_fit", {
        entityId: "scan",
        selectionOnly: true,
        options,
        expectedRevision: api.currentRevision(),
        requestId: `invalid-cloud-${mode}`,
      });
      expect(response).toMatchObject({
        ok: true,
        result: { jobId: expect.any(String) },
      });
      const jobId = (response as { result: { jobId: string } }).result.jobId;
      await vi.waitFor(async () => {
        expect(await api.invoke("job_get", { jobId })).toMatchObject({
          ok: true,
          result: {
            status: "failed",
            error: { message: expect.stringMatching(/select|mask/i) },
          },
        });
      });
      expect(fitGridSurfaceAsync).not.toHaveBeenCalled();
      expect(h.commit).not.toHaveBeenCalled();
    } finally {
      api.dispose();
    }
  },
);
