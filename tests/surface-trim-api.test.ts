import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { CadClient } from "../src/cad/client";
import type { ParametricRecipe } from "../src/parametric";

const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
function setup() {
  const state: WorkspaceSnapshot = {
    name: "Trim",
    entities: ["source", "cutter"].map((id) => ({
      id,
      name: id,
      kind: "cad",
      kernelId: id + "-native",
      brep: id + "-brep",
      positions,
      visible: true,
      opacity: 1,
      color: "#ffffff",
      parametric: {
        feature: {
          id,
          name: id,
          recipe: { kind: "importBrep", brep: id + "-brep" },
        },
        output: 0,
      },
    })),
    history: [],
    future: [],
    authoring: {},
    selectedId: "source",
    selection: null,
    settings: {},
  };
  const cad = {
    trimSurfaces: vi.fn(async () => ({
      kernelId: "trimmed",
      brep: "trim-brep",
      positions,
    })),
    release: vi.fn(async () => {}),
  } as unknown as CadClient;
  const host = {
    snapshot: () => state,
    cad: () => cad,
    commit: vi.fn((entities, label) => {
      state.history = [...state.history, { entities: state.entities, label }];
      state.entities = entities;
    }),
    select: vi.fn((id) => {
      state.selectedId = id;
    }),
    busy: () => false,
    activity: vi.fn(),
  } as unknown as WorkspaceHost;
  const api = new ApplicationApi(host, createOperations(host));
  const recipe: ParametricRecipe = {
    kind: "trimSurfaces",
    source: { featureId: "source" },
    cutters: [{ featureId: "cutter" }],
    keepPoints: [[-2, 0, 0]],
    toleranceMm: 0.001,
  };
  return { state, cad, host, api, recipe };
}
async function settled(api: ApplicationApi, jobId: string) {
  for (let i = 0; i < 50; i++) {
    const reply = await api.invoke("job_get", { jobId });
    expect(reply.ok).toBe(true);
    if (!reply.ok) throw Error(reply.error.message);
    const job = reply.result as any;
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw Error("Trim job did not settle");
}
it("publishes one retry-safe exact trim through the MCP contract and retains its editable recipe", async () => {
  const h = setup();
  try {
    const args = {
      recipe: h.recipe,
      name: "Retained surface",
      selectCreated: true,
      expectedRevision: h.api.currentRevision(),
      requestId: "trim-create",
    };
    const receipt = await h.api.invoke("cad_create", args);
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    const job = await settled(h.api, (receipt.result as any).jobId);
    expect(job.status).toBe("succeeded");
    expect(h.state.entities).toHaveLength(3);
    expect(h.state.history).toHaveLength(1);
    expect(h.state.entities[2].parametric!.feature.recipe).toEqual(h.recipe);
    expect(h.state.selectedId).toBe(job.result.entityIds[0]);
    expect(await h.api.invoke("cad_create", args)).toEqual(receipt);
    expect(h.cad.trimSurfaces).toHaveBeenCalledTimes(1);
    expect(h.state.entities[0].kernelId).toBe("source-native");
    expect(h.state.entities[1].kernelId).toBe("cutter-native");
  } finally {
    h.api.dispose();
  }
});
it("keeps the complete workspace and native inputs when trimming fails", async () => {
  const h = setup();
  vi.mocked(h.cad.trimSurfaces).mockRejectedValue(
    Error("Retained point is outside the surface tolerance"),
  );
  const original = h.state.entities,
    revision = h.api.currentRevision();
  try {
    const receipt = await h.api.invoke("cad_create", {
      recipe: h.recipe,
      name: "Bad trim",
      expectedRevision: revision,
      requestId: "bad-trim",
    });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    expect((await settled(h.api, (receipt.result as any).jobId)).status).toBe(
      "failed",
    );
    expect(h.state.entities).toBe(original);
    expect(h.state.history).toHaveLength(0);
    expect(h.api.currentRevision()).toBe(revision);
    expect(vi.mocked(h.cad.release).mock.calls.flat(2)).not.toContain(
      "source-native",
    );
  } finally {
    h.api.dispose();
  }
});

it("releases a late cancelled trim result without publishing or releasing inputs", async () => {
  const h = setup();
  let finish!: (value: any) => void;
  vi.mocked(h.cad.trimSurfaces).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const original = h.state.entities;
  try {
    const receipt = await h.api.invoke("cad_create", {
      recipe: h.recipe,
      name: "Cancelled trim",
      expectedRevision: h.api.currentRevision(),
      requestId: "cancel-trim",
    });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    await vi.waitFor(() => expect(h.cad.trimSurfaces).toHaveBeenCalledOnce());
    await h.api.invoke("job_cancel", { jobId: (receipt.result as any).jobId });
    finish({ kernelId: "late-trim", brep: "late-brep", positions });
    await vi.waitFor(() =>
      expect(vi.mocked(h.cad.release).mock.calls.flat(2)).toContain(
        "late-trim",
      ),
    );
    expect(h.state.entities).toBe(original);
    expect(h.state.history).toHaveLength(0);
    expect(vi.mocked(h.cad.release).mock.calls.flat(2)).not.toContain(
      "source-native",
    );
  } finally {
    h.api.dispose();
  }
});

it("rejects locked trim feature rebuilds before native work", async () => {
  const h = setup();
  try {
    const created = await h.api.invoke("cad_create", {
      recipe: h.recipe,
      name: "Trim",
      expectedRevision: h.api.currentRevision(),
      requestId: "create-for-lock",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = await settled(h.api, (created.result as any).jobId);
    h.state.entities[2].locked = true;
    const revision = h.api.currentRevision(),
      entities = h.state.entities,
      history = h.state.history;
    const receipt = await h.api.invoke("cad_rebuild", {
      entityId: result.result.entityIds[0],
      recipe: h.recipe,
      expectedRevision: revision,
      requestId: "locked-rebuild",
    });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    const failed = await settled(h.api, (receipt.result as any).jobId);
    expect(failed.status).toBe("failed");
    expect(failed.error.message).toMatch(/locked/i);
    expect(h.state.entities).toBe(entities);
    expect(h.state.history).toBe(history);
    expect(h.cad.trimSurfaces).toHaveBeenCalledOnce();
  } finally {
    h.api.dispose();
  }
});
