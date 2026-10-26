import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  validateInput,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createAuthoringOperations } from "../src/automation/authoring-operations";
import { createOperations } from "../src/automation/operations";
import catalog from "../src/automation/catalog.json";
import { createGridPatch, tessellatePatch } from "../src/surfaces";
import type { CadClient } from "../src/cad/client";

function setup(exact = false) {
  const reference = createGridPatch(4, 4, 10, 10, 3);
  const target = structuredClone(reference);
  target.points = target.points.map((p) => [p[0] + 18, p[1], p[2]]);
  const state: WorkspaceSnapshot = {
    name: "Blend",
    entities: [target, reference].map((patch, i) => ({
      id: i ? "reference" : "target",
      name: i ? "Locked reference" : "Target",
      kind: exact ? "cad" : "mesh",
      color: "#ffffff",
      visible: true,
      opacity: 1,
      locked: i === 1,
      positions: tessellatePatch(patch),
      surfacePatch: patch,
      surfaceScanId: "original-scan",
      ...(exact
        ? {
            kernelId: i ? "reference-native" : "target-native",
            brep: i ? "reference-brep" : "target-brep",
            parametric: {
              feature: {
                id: i ? "reference-feature" : "target-feature",
                name: i ? "Reference" : "Target",
                recipe: { kind: "surface" as const, patch },
              },
              output: 0,
            },
          }
        : {}),
    })),
    history: [],
    future: [],
    authoring: {},
    selectedId: "target",
    selection: null,
    settings: {},
  };
  const cad = {
    surface: vi.fn(async (patch) => ({
      kernelId: "bridge-native",
      brep: "bridge-brep",
      positions: Array.from(tessellatePatch(patch)),
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
  const api = new ApplicationApi(host, {
    ...createOperations(host),
    ...createAuthoringOperations(host),
  });
  const options = { referenceEdge: "u1", targetEdge: "u0", continuity: "C1" };
  const args = {
    entityId: "target",
    operation: "blend",
    referenceId: "reference",
    options,
    expectedRevision: api.currentRevision(),
    requestId: "blend",
  };
  return { state, host, cad, api, reference, target, options, args };
}

async function settle(api: ApplicationApi, receipt: any) {
  expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
  if (!receipt.ok) throw Error(receipt.error.message);
  for (let i = 0; i < 100; i++) {
    const reply = await api.invoke("job_get", { jobId: receipt.result.jobId });
    if (!reply.ok) throw Error(reply.error.message);
    const job = reply.result as any;
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw Error("Blend did not settle");
}

for (const exact of [false, true])
  it(`materializes an independent exact bridge from ${exact ? "exact" : "mesh"} sources in one retry-safe history step`, async () => {
    const h = setup(exact),
      original = h.state.entities,
      before = structuredClone(original);
    try {
      const receipt = await h.api.invoke("surface_operation", h.args);
      const job = await settle(h.api, receipt);
      expect(job.status, JSON.stringify(job)).toBe("succeeded");
      expect(h.state.entities).toHaveLength(3);
      const created = h.state.entities[2];
      expect(created).toMatchObject({
        kind: "cad",
        kernelId: "bridge-native",
        brep: "bridge-brep",
        surfacePatch: { countU: 4, countV: 4, degreeU: 3, degreeV: 3 },
        parametric: { feature: { recipe: { kind: "surface" } }, output: 0 },
      });
      expect(created.id).not.toBe("target");
      expect(created.id).not.toBe("reference");
      expect(created.surfacePatch!.points[0]).toEqual([10, 0, 0]);
      expect(created.surfacePatch!.points[3]).toEqual([18, 0, 0]);
      expect(created.parametric!.feature.recipe).toEqual({
        kind: "surface",
        patch: created.surfacePatch,
      });
      expect(created.surfaceScanId).toBeUndefined();
      expect(job.result).toMatchObject({
        entityId: created.id,
        featureId: created.parametric!.feature.id,
        representation: "exactCad",
        options: { ...h.options, reverse: false },
        referenceSource: { kind: "entity", entityId: "reference" },
      });
      expect(h.state.entities.slice(0, 2)).toEqual(before);
      expect(original).toEqual(before);
      expect(h.state.entities[0].surfacePatch).toBe(h.target);
      expect(h.state.entities[1].surfacePatch).toBe(h.reference);
      expect(h.state.history).toHaveLength(1);
      expect(h.state.history[0].entities).toBe(original);
      expect(h.state.selectedId).toBe("target");
      expect(h.host.select).not.toHaveBeenCalled();
      expect(await h.api.invoke("surface_operation", h.args)).toEqual(receipt);
      expect(h.cad.surface).toHaveBeenCalledOnce();
      expect(h.cad.release).not.toHaveBeenCalled();
      const patch = await h.api.invoke("surface_get", { entityId: created.id });
      expect(patch).toMatchObject({
        ok: true,
        result: { patch: created.surfacePatch },
      });
    } finally {
      h.api.dispose();
    }
  });

it("accepts the GUI raw reference contract, optional name and C0/reversal without retaining a source dependency", async () => {
  const h = setup(),
    before = structuredClone(h.reference);
  try {
    const { referenceId: _, ...args } = h.args;
    const job = await settle(
      h.api,
      await h.api.invoke("surface_operation", {
        ...args,
        name: "Transition",
        referencePatch: h.reference,
        options: { ...h.options, continuity: "C0", reverse: true },
      }),
    );
    expect(job.status, JSON.stringify(job)).toBe("succeeded");
    const created = h.state.entities[2];
    expect(created.name).toBe("Transition");
    expect(created.surfacePatch).toMatchObject({ countU: 2, degreeU: 1 });
    expect(created.surfacePatch!.points[0]).toEqual([10, 10, 0]);
    expect(created.surfacePatch!.points[1]).toEqual([18, 0, 0]);
    expect(job.result.referenceSource).toEqual({ kind: "patch" });
    expect(job.result.options).toEqual({
      ...h.options,
      continuity: "C0",
      reverse: true,
    });
    expect(h.reference).toEqual(before);
  } finally {
    h.api.dispose();
  }
});

for (const mode of [
  "missing",
  "ambiguous",
  "self",
  "unknown",
  "invalid",
  "incompatible",
])
  it(`rejects a ${mode} blend reference without publication or native evaluation`, async () => {
    const h = setup(true),
      entities = h.state.entities;
    try {
      const { referenceId: _, ...args } = h.args;
      const reference =
        mode === "missing"
          ? {}
          : mode === "ambiguous"
            ? { referenceId: "reference", referencePatch: h.reference }
            : mode === "self"
              ? { referenceId: "target" }
              : mode === "unknown"
                ? { referenceId: "absent" }
                : {
                    referencePatch:
                      mode === "invalid"
                        ? { ...h.reference, knotsU: [0, 0, 0, 0, 0, 0, 0, 0] }
                        : createGridPatch(4, 5, 10, 10, 3),
                  };
      const job = await settle(
        h.api,
        await h.api.invoke("surface_operation", { ...args, ...reference }),
      );
      expect(job.status).toBe("failed");
      expect(h.state.entities).toBe(entities);
      expect(h.state.history).toHaveLength(0);
      expect(h.cad.surface).not.toHaveBeenCalled();
      expect(h.cad.release).not.toHaveBeenCalled();
    } finally {
      h.api.dispose();
    }
  });

for (const mode of ["locked", "pointcloud", "uneditableExact", "missingTarget"])
  it(`preserves existing surface target eligibility for ${mode}`, async () => {
    const h = setup(true),
      entities = h.state.entities;
    if (mode === "locked") entities[0].locked = true;
    if (mode === "pointcloud") {
      entities[0].kind = "pointcloud";
      delete entities[0].kernelId;
      delete entities[0].parametric;
    }
    if (mode === "uneditableExact")
      entities[0].parametric!.feature = {
        ...entities[0].parametric!.feature,
        recipe: { kind: "importBrep", brep: "target-brep" },
      };
    const before = structuredClone(entities);
    try {
      const { entityId, ...request } = h.args;
      const job = await settle(
        h.api,
        await h.api.invoke("surface_operation", {
          ...request,
          ...(mode === "missingTarget" ? {} : { entityId }),
          expectedRevision: h.api.currentRevision(),
        }),
      );
      expect(job.status).toBe("failed");
      expect(h.state.entities).toBe(entities);
      expect(entities).toEqual(before);
      expect(h.state.history).toHaveLength(0);
      expect(h.cad.surface).not.toHaveBeenCalled();
    } finally {
      h.api.dispose();
    }
  });

it("materializes a downstream reference snapshot without changing or depending on either source", async () => {
  const h = setup(true);
  h.state.entities[1].parametric!.feature = {
    ...h.state.entities[1].parametric!.feature,
    recipe: {
      kind: "offset",
      source: { featureId: "target-feature" },
      distance: 1,
    },
  };
  const before = structuredClone(h.state.entities);
  try {
    const job = await settle(
      h.api,
      await h.api.invoke("surface_operation", {
        ...h.args,
        expectedRevision: h.api.currentRevision(),
      }),
    );
    expect(job.status, JSON.stringify(job)).toBe("succeeded");
    expect(h.state.entities.slice(0, 2)).toEqual(before);
    const created = h.state.entities[2];
    expect(created.parametric!.feature.recipe).toEqual({
      kind: "surface",
      patch: created.surfacePatch,
    });
    expect(created.surfacePatch!.points[0]).toEqual([10, 0, 0]);
    expect(h.cad.release).not.toHaveBeenCalled();
  } finally {
    h.api.dispose();
  }
});

it("keeps sources/history/revision when the native bridge fails", async () => {
  const h = setup(true),
    entities = h.state.entities,
    revision = h.api.currentRevision();
  vi.mocked(h.cad.surface).mockRejectedValue(
    Error("Native surface is invalid"),
  );
  try {
    const job = await settle(
      h.api,
      await h.api.invoke("surface_operation", h.args),
    );
    expect(job).toMatchObject({
      status: "failed",
      error: { message: "Native surface is invalid" },
    });
    expect(h.state.entities).toBe(entities);
    expect(h.state.history).toHaveLength(0);
    expect(h.api.currentRevision()).toBe(revision);
    expect(h.cad.release).not.toHaveBeenCalled();
  } finally {
    h.api.dispose();
  }
});

it("retires a cancelled late bridge while retaining source and history handles", async () => {
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
    const receipt = await h.api.invoke("surface_operation", h.args);
    expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
    if (!receipt.ok) return;
    await vi.waitFor(() => expect(h.cad.surface).toHaveBeenCalledOnce());
    expect(h.state.selectedId).toBe("target");
    await h.api.invoke("job_cancel", { jobId: (receipt.result as any).jobId });
    finish({
      kernelId: "late-bridge",
      brep: "late",
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    });
    expect((await settle(h.api, receipt)).status).toBe("cancelled");
    expect(h.state.entities).toBe(entities);
    expect(h.state.history).toHaveLength(0);
    expect(h.cad.release).toHaveBeenCalledWith(["late-bridge"]);
    expect(vi.mocked(h.cad.release).mock.calls.flat(2)).not.toContain(
      "target-native",
    );
    expect(vi.mocked(h.cad.release).mock.calls.flat(2)).not.toContain(
      "reference-native",
    );
  } finally {
    h.api.dispose();
  }
});

it("releases only the new bridge when guarded publication fails", async () => {
  const h = setup(true),
    entities = h.state.entities;
  vi.mocked(h.host.commit).mockImplementation(() => {
    throw Error("Publication failed");
  });
  try {
    const job = await settle(
      h.api,
      await h.api.invoke("surface_operation", h.args),
    );
    expect(job).toMatchObject({
      status: "failed",
      error: { message: "Publication failed" },
    });
    expect(h.state.entities).toBe(entities);
    expect(h.state.history).toHaveLength(0);
    expect(h.cad.release).toHaveBeenCalledExactlyOnceWith(["bridge-native"]);
  } finally {
    h.api.dispose();
  }
});

it("discovers blend and validates bounded patch/options through the public schema", () => {
  const schema = catalog.find(
    (tool) => tool.name === "surface_operation",
  )!.inputSchema;
  const patch = createGridPatch(4, 4, 10, 10, 3);
  const args = {
    entityId: "target",
    operation: "blend",
    referencePatch: patch,
    options: { referenceEdge: "u1", targetEdge: "u0", continuity: "C1" },
    expectedRevision: 0,
    requestId: "schema",
  };
  expect(() => validateInput(schema, args)).not.toThrow();
  expect(() =>
    validateInput(schema, {
      ...args,
      options: { ...args.options, continuity: "G2" },
    }),
  ).toThrow();
  expect(() =>
    validateInput(schema, { ...args, selectCreated: true }),
  ).toThrow();
  expect(() =>
    validateInput(schema, {
      ...args,
      referencePatch: { ...patch, points: Array(257).fill([0, 0, 0]) },
    }),
  ).toThrow();
  expect(() =>
    validateInput(schema, {
      ...args,
      referencePatch: { ...patch, weights: Array(16).fill(0) },
    }),
  ).toThrow();
});
