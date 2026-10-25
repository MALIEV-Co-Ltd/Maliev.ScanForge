import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createAuthoringOperations } from "../src/automation/authoring-operations";
import { createOperations } from "../src/automation/operations";
import { createGridPatch, tessellatePatch } from "../src/surfaces";
import type { CadClient } from "../src/cad/client";

function setup(exact = false) {
  const reference = createGridPatch(4, 4, 10, 10, 3),
    target = structuredClone(reference);
  target.points = target.points.map((p) => [p[0] + 8, p[1], p[2]]);
  const state: WorkspaceSnapshot = {
    name: "Join",
    entities: [
      {
        id: "target",
        name: "Target",
        kind: exact ? "cad" : "mesh",
        color: "#ffffff",
        visible: true,
        opacity: 1,
        positions: tessellatePatch(target),
        surfacePatch: target,
        surfaceScanId: "original-scan",
        ...(exact
          ? {
              kernelId: "old-target",
              brep: "old-brep",
              parametric: {
                feature: {
                  id: "target-feature",
                  name: "Target",
                  recipe: { kind: "surface", patch: target },
                },
                output: 0,
              },
            }
          : {}),
      },
      {
        id: "reference",
        name: "Fixed reference",
        kind: "mesh",
        color: "#ffffff",
        visible: true,
        opacity: 1,
        locked: true,
        positions: tessellatePatch(reference),
        surfacePatch: reference,
      },
    ],
    history: [],
    future: [],
    authoring: {},
    selectedId: "target",
    selection: null,
    settings: {},
  };
  const cad = {
    surface: vi.fn(async (patch) => ({
      kernelId: "new-target",
      brep: "new-brep",
      positions: Array.from(tessellatePatch(patch)),
    })),
    release: vi.fn(async () => {}),
  } as unknown as CadClient;
  const host = {
    snapshot: () => state,
    cad: () => cad,
    commit: vi.fn((next) => {
      state.history = [
        ...state.history,
        { entities: state.entities, label: "Join" },
      ];
      state.entities = next;
    }),
    busy: () => false,
    activity: vi.fn(),
    select: vi.fn(),
  } as unknown as WorkspaceHost;
  const api = new ApplicationApi(host, {
    ...createOperations(host),
    ...createAuthoringOperations(host),
  });
  const options = { referenceEdge: "u1", targetEdge: "u0", continuity: "C1" };
  return { api, state, cad, host, reference, target, options };
}
async function settle(api: ApplicationApi, receipt: any) {
  expect(receipt.ok).toBe(true);
  if (!receipt.ok) throw Error(receipt.error.message);
  for (let i = 0; i < 100; i++) {
    const reply = await api.invoke("job_get", { jobId: receipt.result.jobId });
    if (!reply.ok) throw Error(reply.error.message);
    const job = reply.result as any;
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw Error("Join did not settle");
}
for (const exact of [false, true])
  it(`joins ${exact ? "exact" : "mesh"} surfaces from the GUI's raw reference contract in one retry-safe transaction`, async () => {
    const h = setup(exact),
      fixed = structuredClone(h.state.entities[1]);
    try {
      const args = {
        entityId: "target",
        operation: "join",
        referencePatch: h.reference,
        options: h.options,
        expectedRevision: h.api.currentRevision(),
        requestId: "raw-join",
      };
      const receipt = await h.api.invoke("surface_operation", args),
        job = await settle(h.api, receipt);
      expect(job.status, JSON.stringify(job)).toBe("succeeded");
      expect(h.state.history).toHaveLength(1);
      expect(h.state.entities[0].surfacePatch!.points[0][0]).toBeCloseTo(
        10,
        10,
      );
      expect(h.state.entities[0].surfacePatch!.points[1][0]).toBeCloseTo(
        40 / 3,
        10,
      );
      expect(h.state.entities[0].surfaceScanId).toBe("original-scan");
      expect(h.state.entities[1]).toEqual(fixed);
      expect(h.reference).toEqual(fixed.surfacePatch);
      expect(job.result).toMatchObject({
        entityId: "target",
        representation: exact ? "exactCad" : "mesh",
        referenceSource: { kind: "patch" },
        changedControlIndices: [0, 1, 4, 5, 8, 9, 12, 13],
      });
      expect(await h.api.invoke("surface_operation", args)).toEqual(receipt);
      expect(h.host.commit).toHaveBeenCalledOnce();
      if (exact) {
        expect(h.cad.surface).toHaveBeenCalledOnce();
        expect(h.state.entities[0].brep).toBe("new-brep");
        expect(h.cad.release).not.toHaveBeenCalled();
      }
    } finally {
      h.api.dispose();
    }
  });
it("retains reference-ID joins and rejects self/ambiguous references without publication", async () => {
  for (const reference of [
    { referenceId: "target" },
    { referenceId: "reference", referencePatch: createGridPatch() },
  ]) {
    const h = setup();
    try {
      const job = await settle(
        h.api,
        await h.api.invoke("surface_operation", {
          entityId: "target",
          operation: "join",
          ...reference,
          options: h.options,
          expectedRevision: h.api.currentRevision(),
          requestId: "bad-reference",
        }),
      );
      expect(job.status).toBe("failed");
      expect(h.state.history).toHaveLength(0);
      expect(h.host.commit).not.toHaveBeenCalled();
    } finally {
      h.api.dispose();
    }
  }
  const h = setup();
  try {
    const job = await settle(
      h.api,
      await h.api.invoke("surface_operation", {
        entityId: "target",
        operation: "join",
        referenceId: "reference",
        options: h.options,
        expectedRevision: h.api.currentRevision(),
        requestId: "id-reference",
      }),
    );
    expect(job.status).toBe("succeeded");
    expect(job.result.referenceSource).toEqual({
      kind: "entity",
      entityId: "reference",
    });
  } finally {
    h.api.dispose();
  }
});

it("rejects target/dependent locks and downstream fixed references before native evaluation", async () => {
  for (const mode of ["target", "dependent", "downstream"]) {
    const h = setup(true);
    try {
      if (mode === "target") h.state.entities[0].locked = true;
      if (mode === "dependent")
        h.state.entities.push({
          ...h.state.entities[0],
          id: "dependent",
          kernelId: "dependent-old",
          locked: true,
          parametric: {
            feature: {
              id: "dependent-feature",
              name: "Dependent",
              recipe: {
                kind: "offset",
                source: { featureId: "target-feature" },
                distance: 1,
              },
            },
            output: 0,
          },
        });
      if (mode === "downstream")
        h.state.entities[1] = {
          ...h.state.entities[1],
          kind: "cad",
          kernelId: "reference-old",
          brep: "reference-brep",
          parametric: {
            feature: {
              id: "reference-feature",
              name: "Reference",
              recipe: {
                kind: "offset",
                source: { featureId: "target-feature" },
                distance: 1,
              },
            },
            output: 0,
          },
        };
      const entities = h.state.entities;
      const job = await settle(
        h.api,
        await h.api.invoke("surface_operation", {
          entityId: "target",
          operation: "join",
          referenceId: "reference",
          options: h.options,
          expectedRevision: h.api.currentRevision(),
          requestId: mode,
        }),
      );
      expect(job.status, JSON.stringify(job)).toBe("failed");
      expect(h.state.entities).toBe(entities);
      expect(h.state.history).toHaveLength(0);
      expect(h.cad.surface).not.toHaveBeenCalled();
      expect(h.cad.release).not.toHaveBeenCalled();
    } finally {
      h.api.dispose();
    }
  }
});
it("cancels an exact join and retires its late result without releasing source/history handles", async () => {
  const h = setup(true),
    entities = h.state.entities;
  let finish!: (value: any) => void;
  vi.mocked(h.cad.surface).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  try {
    const receipt = await h.api.invoke("surface_operation", {
      entityId: "target",
      operation: "join",
      referencePatch: h.reference,
      options: h.options,
      expectedRevision: h.api.currentRevision(),
      requestId: "cancel-exact-join",
    });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    await vi.waitFor(() => expect(h.cad.surface).toHaveBeenCalledOnce());
    await h.api.invoke("job_cancel", { jobId: (receipt.result as any).jobId });
    finish({
      kernelId: "late-join",
      brep: "late",
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    });
    const job = await settle(h.api, receipt);
    expect(job.status).toBe("cancelled");
    expect(h.state.entities).toBe(entities);
    expect(h.state.history).toHaveLength(0);
    expect(h.cad.release).toHaveBeenCalledWith(["late-join"]);
    expect(vi.mocked(h.cad.release).mock.calls.flat(2)).not.toContain(
      "old-target",
    );
  } finally {
    h.api.dispose();
  }
});
it("rejects incompatible reference seams without changing either representation", async () => {
  for (const exact of [false, true]) {
    const h = setup(exact),
      entities = h.state.entities;
    try {
      const job = await settle(
        h.api,
        await h.api.invoke("surface_operation", {
          entityId: "target",
          operation: "join",
          referencePatch: createGridPatch(4, 5, 10, 10, 3),
          options: h.options,
          expectedRevision: h.api.currentRevision(),
          requestId: "bad-seam",
        }),
      );
      expect(job.status).toBe("failed");
      expect(h.state.entities).toBe(entities);
      expect(h.state.history).toHaveLength(0);
      expect(h.cad.surface).not.toHaveBeenCalled();
    } finally {
      h.api.dispose();
    }
  }
});

it("rejects oversized raw references before evaluation and non-finite display output before publication", async () => {
  const h = setup(),
    entities = h.state.entities;
  try {
    const oversized = {
      ...h.reference,
      points: Array.from({ length: 257 }, () => [0, 0, 0]),
    };
    const rejected = await h.api.invoke("surface_operation", {
      entityId: "target",
      operation: "join",
      referencePatch: oversized,
      options: h.options,
      expectedRevision: h.api.currentRevision(),
      requestId: "oversized",
    });
    expect(rejected.ok).toBe(false);
    const reference = structuredClone(h.reference);
    reference.points = reference.points.map((point) => [
      1e39,
      point[1],
      point[2],
    ]);
    const job = await settle(
      h.api,
      await h.api.invoke("surface_operation", {
        entityId: "target",
        operation: "join",
        referencePatch: reference,
        options: h.options,
        expectedRevision: h.api.currentRevision(),
        requestId: "overflow",
      }),
    );
    expect(job.status).toBe("failed");
    expect(h.state.entities).toBe(entities);
    expect(h.state.history).toHaveLength(0);
    expect(h.host.commit).not.toHaveBeenCalled();
  } finally {
    h.api.dispose();
  }
});
