import { describe, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  validateInput,
  type ApiResult,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import catalog from "../src/automation/catalog.json";
import { coordinateSketchFrame } from "../src/sketch-frame";
import { featureDependencies } from "../src/parametric";
import { seekModelRevision } from "../src/history";
import type { CadClient } from "../src/cad/client";
import type { Sketch } from "../src/sketch";
import type { Entity, KernelMesh } from "../src/types";
import * as sketchModule from "../src/sketch";

function sketch(): Sketch {
  return {
    version: 1,
    frame: coordinateSketchFrame("OXY", 5),
    reference: {
      kind: "section",
      sourceId: "scan",
      axis: "z",
      offset: 5,
      onSlicingPlane: true,
      selectedOnly: false,
      sampled: false,
      segments: [-2, 0, 2, 0],
    },
    points: [
      { id: "a", x: 2, y: 0 },
      { id: "b", x: -2, y: 0 },
      { id: "center", x: 0, y: 0 },
    ],
    segments: [{ id: "guide", a: "a", b: "center", construction: true }],
    arcs: [
      { id: "top", a: "a", b: "b", center: "center", clockwise: false },
      { id: "bottom", a: "b", b: "a", center: "center", clockwise: false },
    ],
    constraints: [
      { id: "fix-center", kind: "fixed", point: "center", x: 0, y: 0 },
    ],
  };
}
function mesh(kernelId: string): KernelMesh {
  return {
    kernelId,
    brep: `brep-${kernelId}`,
    positions: [0, 0, 5, 1, 0, 5, 0, 1, 5],
  };
}
function setup() {
  const input = sketch();
  const state: WorkspaceSnapshot = {
    name: "Sketch surface",
    entities: [
      {
        id: "scan",
        name: "Source scan",
        kind: "mesh",
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        color: "#abcdef",
        visible: true,
        opacity: 1,
        locked: true,
      },
    ],
    history: [],
    future: [],
    authoring: {
      sketch: input,
      sketches: [{ id: "saved", name: "Section profile", sketch: input }],
      activeSketchId: "saved",
    },
    selectedId: null,
    selection: null,
    settings: {},
  };
  let busy = false,
    sequence = 0;
  const cad = {
    sketchSurface: vi.fn(async (..._args: unknown[]) =>
      mesh(`face-${++sequence}`),
    ),
    thicken: vi.fn(async (..._args: unknown[]) => mesh(`solid-${++sequence}`)),
    release: vi.fn(async (_ids: string[]) => {}),
  };
  const moveHistory = (index: number) =>
    Object.assign(
      state,
      seekModelRevision(state.history, state.entities, state.future, index),
    );
  const host: WorkspaceHost = {
    snapshot: () => ({ ...state }),
    cad: () => cad as unknown as CadClient,
    commit: vi.fn((entities, label) => {
      state.history = [...state.history, { entities: state.entities, label }];
      state.entities = entities;
      state.future = [];
    }),
    select: vi.fn((id) => {
      state.selectedId = id;
    }),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    replace: vi.fn(),
    undo: () => moveHistory(state.history.length - 1),
    redo: () => moveHistory(state.history.length + 1),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => busy,
    activity: (value) => {
      busy = value;
    },
  };
  const api = new ApplicationApi(host, createOperations(host));
  const request = (
    requestId: string,
    recipe: unknown = { kind: "sketchSurface", sketch: input },
  ) => ({
    name: "Section face",
    recipe,
    requestId,
    expectedRevision: api.currentRevision(),
  });
  return { state, input, cad, host, api, request };
}
interface Job {
  status: string;
  result: {
    entityIds: string[];
    featureId: string;
    rebuiltFeatureIds: string[];
  };
  error?: { code: string; message: string };
}
function jobId(receipt: ApiResult): string {
  expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
  if (!receipt.ok) throw Error(receipt.error.message);
  return (receipt.result as { jobId: string }).jobId;
}
async function settle(api: ApplicationApi, receipt: ApiResult): Promise<Job> {
  const id = jobId(receipt);
  for (let i = 0; i < 100; i++) {
    const response = await api.invoke("job_get", { jobId: id });
    if (!response.ok) throw Error(response.error.message);
    const job = response.result as Job;
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw Error("Sketch surface did not settle");
}

describe("shared sketch surface CAD API", () => {
  it("preserves cached legacy extrusion BREP and display buffers while creating and rebuilding an unrelated face", async () => {
    const h = setup();
    const input: Sketch = {
      version: 1,
      points: Array.from({ length: 129 }, (_, i) => ({
        id: `p${i}`,
        x: 10 * Math.cos((2 * Math.PI * i) / 129),
        y: 10 * Math.sin((2 * Math.PI * i) / 129),
      })),
      segments: Array.from({ length: 129 }, (_, i) => ({
        id: `edge${i}`,
        a: `p${i}`,
        b: `p${(i + 1) % 129}`,
      })),
      constraints: [],
    };
    sketchModule.validateSketch(input);
    expect(sketchModule.sketchCurveProfile(input)).toHaveLength(129);
    const legacy: Entity = {
      id: "legacy",
      name: "Cached legacy extrusion",
      kind: "cad",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      color: "#ffffff",
      opacity: 1,
      visible: true,
      brep: "retained-exact-brep",
      kernelId: "retained-native",
      parametric: {
        output: 0,
        feature: {
          id: "legacy-feature",
          name: "Legacy extrusion",
          recipe: {
            kind: "extrude",
            profile: { kind: "sketch-curves", sketch: input },
            height: 5,
          },
        },
      },
    };
    h.state.entities = [...h.state.entities, legacy];
    const authoring = h.state.authoring,
      realSolve = sketchModule.solveSketch;
    const solve = vi
      .spyOn(sketchModule, "solveSketch")
      .mockImplementation((value, ...options) => {
        if (value.points.length > 128)
          throw Error("LEGACY_SOLVER_TRAP: cached CAD must not solve");
        return realSolve(value, ...options);
      });
    const extrudeCurves = vi.fn(() => {
      throw Error("LEGACY_NATIVE_TRAP: cached CAD must not rebuild");
    });
    h.host.cad = () => ({ ...h.cad, extrudeCurves }) as unknown as CadClient;
    try {
      const created = await settle(
        h.api,
        await h.api.invoke("cad_create", h.request("unrelated-create")),
      );
      expect(created.status, JSON.stringify(created)).toBe("succeeded");
      expect(h.state.entities[1]).toBe(legacy);
      const edited = structuredClone(h.input);
      edited.frame = coordinateSketchFrame("OXY", 6);
      const rebuilt = await settle(
        h.api,
        await h.api.invoke("cad_rebuild", {
          entityId: created.result.entityIds[0],
          recipe: { kind: "sketchSurface", sketch: edited },
          expectedRevision: h.api.currentRevision(),
          requestId: "unrelated-rebuild",
        }),
      );
      expect(rebuilt.status, JSON.stringify(rebuilt)).toBe("succeeded");
      expect(rebuilt.result.rebuiltFeatureIds).toEqual([
        created.result.featureId,
      ]);
      expect(Array.from(h.state.entities[1].positions)).toEqual(
        Array.from(legacy.positions),
      );
      expect(h.state.entities[1].brep).toBe(legacy.brep);
      expect(h.state.entities[1].kernelId).toBe(legacy.kernelId);
      expect(h.state.authoring).toBe(authoring);
      expect(h.state.history).toHaveLength(2);
      const unchanged = await settle(
        h.api,
        await h.api.invoke("cad_rebuild", {
          entityId: legacy.id,
          recipe: legacy.parametric!.feature.recipe,
          expectedRevision: h.api.currentRevision(),
          requestId: "explicit-identical-legacy",
        }),
      );
      expect(unchanged).toMatchObject({
        status: "failed",
        error: { message: expect.stringMatching(/CAD sketch solver.*limit/i) },
      });
      const duplicate = await settle(
        h.api,
        await h.api.invoke(
          "cad_create",
          h.request("explicit-legacy-copy", legacy.parametric!.feature.recipe),
        ),
      );
      expect(duplicate).toMatchObject({
        status: "failed",
        error: { message: expect.stringMatching(/CAD sketch solver.*limit/i) },
      });
      expect(h.state.history).toHaveLength(2);
      expect(extrudeCurves).not.toHaveBeenCalled();
      expect(solve).toHaveBeenCalledTimes(2);
      expect(h.cad.release).not.toHaveBeenCalled();
    } finally {
      solve.mockRestore();
      h.api.dispose();
    }
  });

  it.each(["sketchSurface", "sketch-curves", "sketch"])(
    "rejects oversized %s solver input before solving or mutating shared model/authoring",
    async (kind) => {
      const h = setup(),
        input = structuredClone(h.input);
      input.points = [
        { id: "p0", x: 0, y: 0 },
        { id: "p1", x: 4, y: 0 },
        { id: "p2", x: 4, y: 3 },
        { id: "p3", x: 0, y: 3 },
        ...Array.from({ length: 125 }, (_, i) => ({
          id: `unused${i}`,
          x: i,
          y: 10,
        })),
      ];
      input.segments = Array.from({ length: 4 }, (_, i) => ({
        id: `edge${i}`,
        a: `p${i}`,
        b: `p${(i + 1) % 4}`,
      }));
      input.arcs = [];
      input.constraints = [
        { id: "unsatisfied", kind: "fixed", point: "p0", x: 1, y: 0 },
      ];
      sketchModule.validateSketch(input);
      expect(sketchModule.sketchCurveProfile(input)).toHaveLength(4);
      const recipe =
        kind === "sketchSurface"
          ? { kind, sketch: input }
          : { kind: "extrude", profile: { kind, sketch: input }, height: 2 };
      const before = structuredClone(input),
        authoring = h.state.authoring,
        entities = h.state.entities,
        revision = h.api.currentRevision();
      const solve = vi
        .spyOn(sketchModule, "solveSketch")
        .mockImplementation(() => {
          throw Error("SOLVER_ADMISSION_TRAP: dense solver must not start");
        });
      try {
        const result = await settle(
          h.api,
          await h.api.invoke("cad_create", h.request("oversized", recipe)),
        );
        expect(result).toMatchObject({
          status: "failed",
          error: {
            message: expect.stringMatching(
              /CAD sketch solver.*(?:budget|limit)/i,
            ),
          },
        });
        expect(solve).not.toHaveBeenCalled();
        expect(h.cad.sketchSurface).not.toHaveBeenCalled();
        expect(h.host.commit).not.toHaveBeenCalled();
        expect(h.host.setSketch).not.toHaveBeenCalled();
        expect(h.state.entities).toBe(entities);
        expect(h.state.authoring).toBe(authoring);
        expect(h.state.history).toHaveLength(0);
        expect(h.api.currentRevision()).toBe(revision);
        expect(input).toEqual(before);
      } finally {
        solve.mockRestore();
        h.api.dispose();
      }
    },
  );

  it.each([true, false, undefined])(
    "creates one retry-safe model edit and preserves sketch/scan (selectCreated=%s)",
    async (selectCreated) => {
      const h = setup(),
        authoring = h.state.authoring,
        before = structuredClone(authoring),
        scan = h.state.entities[0];
      const args = {
        ...h.request("create-face"),
        ...(selectCreated === undefined ? {} : { selectCreated }),
      };
      try {
        const receipt = await h.api.invoke("cad_create", args),
          job = await settle(h.api, receipt);
        expect(job.status, JSON.stringify(job)).toBe("succeeded");
        const face = h.state.entities[1];
        expect(face).toMatchObject({
          id: job.result.entityIds[0],
          kind: "cad",
          kernelId: "face-1",
          parametric: {
            output: 0,
            feature: {
              recipe: { kind: "sketchSurface", sketch: before.sketch },
            },
          },
        });
        expect(featureDependencies(face.parametric!.feature.recipe)).toEqual(
          [],
        );
        expect(h.state.entities[0]).toBe(scan);
        expect(h.state.authoring).toBe(authoring);
        expect(authoring).toEqual(before);
        expect(face.parametric!.feature.recipe).not.toBe(args.recipe);
        expect(h.state.history).toHaveLength(1);
        expect(h.state.selectedId).toBe(selectCreated ? face.id : null);
        expect(h.host.select).toHaveBeenCalledTimes(selectCreated ? 1 : 0);
        expect(h.host.setSketch).not.toHaveBeenCalled();
        expect(await h.api.invoke("cad_create", args)).toEqual(receipt);
        expect(h.cad.sketchSurface).toHaveBeenCalledOnce();
        expect(h.host.commit).toHaveBeenCalledOnce();
        expect(
          await h.api.invoke("object_get", { entityId: face.id }),
        ).toMatchObject({ ok: true, result: { parametric: face.parametric } });
        h.input.points[0].x = 8;
        expect(face.parametric!.feature.recipe).toEqual({
          kind: "sketchSurface",
          sketch: before.sketch,
        });
      } finally {
        h.api.dispose();
      }
    },
  );

  it("rebuilds an explicit embedded snapshot and preserves previous outputs and authoring through undo/redo", async () => {
    const h = setup(),
      authoring = h.state.authoring;
    try {
      const create = await settle(
        h.api,
        await h.api.invoke("cad_create", h.request("create")),
      );
      expect(create.status).toBe("succeeded");
      const original = h.state.entities[1],
        edited = sketch();
      edited.frame = coordinateSketchFrame("OYZ", 9);
      edited.reference = { ...edited.reference!, axis: "x", offset: 9 };
      const args = {
        entityId: original.id,
        recipe: { kind: "sketchSurface", sketch: edited },
        expectedRevision: h.api.currentRevision(),
        requestId: "rebuild",
      };
      const receipt = await h.api.invoke("cad_rebuild", args),
        rebuilt = await settle(h.api, receipt);
      expect(rebuilt).toMatchObject({
        status: "succeeded",
        result: { rebuiltFeatureIds: [original.parametric!.feature.id] },
      });
      const next = h.state.entities[1];
      expect(next.id).toBe(original.id);
      expect(next.kernelId).toBe("face-2");
      expect(next.parametric!.feature.recipe).toEqual(args.recipe);
      expect(h.cad.sketchSurface.mock.calls[1][1]).toEqual(edited.frame);
      expect(h.state.history).toHaveLength(2);
      expect(h.state.authoring).toBe(authoring);
      expect(await h.api.invoke("cad_rebuild", args)).toEqual(receipt);
      for (const [command, kernelId] of [
        ["history_undo", "face-1"],
        ["history_redo", "face-2"],
      ]) {
        expect(
          (
            await h.api.invoke(command, {
              scope: "model",
              expectedRevision: h.api.currentRevision(),
              requestId: command,
            })
          ).ok,
        ).toBe(true);
        expect(h.state.entities[1].kernelId).toBe(kernelId);
        expect(h.state.authoring).toBe(authoring);
      }
      expect(h.cad.release).not.toHaveBeenCalled();
    } finally {
      h.api.dispose();
    }
  });

  it("preserves ordinary downstream thicken dependencies when the embedded profile is rebuilt", async () => {
    const h = setup();
    try {
      const face = await settle(
        h.api,
        await h.api.invoke("cad_create", h.request("face")),
      );
      expect(face.status).toBe("succeeded");
      const solid = await settle(
        h.api,
        await h.api.invoke(
          "cad_create",
          h.request("solid", {
            kind: "thicken",
            source: { featureId: face.result.featureId },
            thickness: 1.8,
          }),
        ),
      );
      expect(solid.status).toBe("succeeded");
      expect(h.cad.thicken).toHaveBeenCalledWith("face-1", 1.8);
      const edited = sketch();
      edited.frame = coordinateSketchFrame("OXY", 6);
      const result = await settle(
        h.api,
        await h.api.invoke("cad_rebuild", {
          entityId: face.result.entityIds[0],
          recipe: { kind: "sketchSurface", sketch: edited },
          expectedRevision: h.api.currentRevision(),
          requestId: "rebuild-chain",
        }),
      );
      expect(result).toMatchObject({
        status: "succeeded",
        result: {
          rebuiltFeatureIds: [face.result.featureId, solid.result.featureId],
        },
      });
      expect(h.cad.thicken).toHaveBeenLastCalledWith("face-3", 1.8);
      expect(h.state.history).toHaveLength(3);
      expect(h.cad.release).not.toHaveBeenCalled();
    } finally {
      h.api.dispose();
    }
  });

  it("keeps request/revision and locked feature guards before native acquisition", async () => {
    const h = setup();
    try {
      const args = h.request("first"),
        receipt = await h.api.invoke("cad_create", args);
      expect((await settle(h.api, receipt)).status).toBe("succeeded");
      expect(
        await h.api.invoke("cad_create", { ...args, name: "Different" }),
      ).toMatchObject({ ok: false, error: { code: "REQUEST_CONFLICT" } });
      expect(
        await h.api.invoke("cad_create", { ...args, requestId: "stale" }),
      ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
      h.state.entities = h.state.entities.map((e) =>
        e.id === "scan" ? e : { ...e, locked: true },
      );
      const face = h.state.entities[1];
      const result = await settle(
        h.api,
        await h.api.invoke("cad_rebuild", {
          entityId: face.id,
          recipe: { kind: "sketchSurface", sketch: h.input },
          expectedRevision: h.api.currentRevision(),
          requestId: "locked",
        }),
      );
      expect(result).toMatchObject({
        status: "failed",
        error: { message: expect.stringMatching(/locked/i) },
      });
      expect(h.cad.sketchSurface).toHaveBeenCalledOnce();
      expect(h.state.history).toHaveLength(1);
    } finally {
      h.api.dispose();
    }
  });

  it.each(["conflict", "open", "frame", "native"])(
    "preserves source, authoring, history and revision after %s failure",
    async (mode) => {
      const h = setup(),
        entities = h.state.entities,
        authoring = h.state.authoring,
        before = structuredClone(authoring),
        input = structuredClone(h.input),
        revision = h.api.currentRevision();
      if (mode === "conflict")
        input.constraints.push({
          id: "conflict",
          kind: "fixed",
          point: "center",
          x: 2,
          y: 0,
        });
      if (mode === "open") input.arcs!.pop();
      if (mode === "frame")
        input.frame = { ...input.frame!, normal: [0, 0, -1] };
      if (mode === "native")
        h.cad.sketchSurface.mockRejectedValueOnce(Error("Native face invalid"));
      try {
        const result = await settle(
          h.api,
          await h.api.invoke(
            "cad_create",
            h.request("invalid", { kind: "sketchSurface", sketch: input }),
          ),
        );
        expect(result.status).toBe("failed");
        expect(h.state.entities).toBe(entities);
        expect(h.state.authoring).toBe(authoring);
        expect(authoring).toEqual(before);
        expect(h.state.history).toHaveLength(0);
        expect(h.api.currentRevision()).toBe(revision);
        expect(h.cad.sketchSurface).toHaveBeenCalledTimes(
          mode === "native" ? 1 : 0,
        );
        expect(h.cad.release).not.toHaveBeenCalled();
      } finally {
        h.api.dispose();
      }
    },
  );

  it.each(["cancel", "stale"])(
    "releases a late native face after %s while preserving source/history",
    async (mode) => {
      const h = setup(),
        entities = h.state.entities,
        authoring = h.state.authoring;
      let finish!: (value: KernelMesh) => void;
      h.cad.sketchSurface.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      try {
        const receipt = await h.api.invoke("cad_create", h.request("late"));
        const id = jobId(receipt);
        await vi.waitFor(() =>
          expect(h.cad.sketchSurface).toHaveBeenCalledOnce(),
        );
        if (mode === "cancel")
          expect((await h.api.invoke("job_cancel", { jobId: id })).ok).toBe(
            true,
          );
        else h.state.authoring = { ...authoring, activeSketchId: undefined };
        finish(mesh("late-face"));
        const job = await settle(h.api, receipt);
        expect(job.status).toBe(mode === "cancel" ? "cancelled" : "failed");
        if (mode === "stale") expect(job.error?.code).toBe("REVISION_CONFLICT");
        expect(h.state.entities).toBe(entities);
        expect(h.state.history).toHaveLength(0);
        expect(h.host.setSketch).not.toHaveBeenCalled();
        expect(h.cad.release).toHaveBeenCalledExactlyOnceWith(["late-face"]);
      } finally {
        h.api.dispose();
      }
    },
  );

  it("releases only newly owned output when model publication fails", async () => {
    const h = setup(),
      entities = h.state.entities;
    vi.mocked(h.host.commit).mockImplementationOnce(() => {
      throw Error("Publication failed");
    });
    try {
      const result = await settle(
        h.api,
        await h.api.invoke("cad_create", h.request("publish-failure")),
      );
      expect(result).toMatchObject({
        status: "failed",
        error: { message: "Publication failed" },
      });
      expect(h.state.entities).toBe(entities);
      expect(h.state.history).toHaveLength(0);
      expect(h.cad.release).toHaveBeenCalledExactlyOnceWith(["face-1"]);
    } finally {
      h.api.dispose();
    }
  });

  it("retires a cancelled late rebuild while retaining the face referenced by model history", async () => {
    const h = setup();
    let finish!: (value: KernelMesh) => void;
    try {
      const first = await settle(
        h.api,
        await h.api.invoke("cad_create", h.request("initial-face")),
      );
      expect(first.status).toBe("succeeded");
      const entities = h.state.entities,
        history = h.state.history,
        authoring = h.state.authoring;
      h.cad.sketchSurface.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const edited = sketch();
      edited.frame = coordinateSketchFrame("OXY", 6);
      const receipt = await h.api.invoke("cad_rebuild", {
        entityId: first.result.entityIds[0],
        recipe: { kind: "sketchSurface", sketch: edited },
        expectedRevision: h.api.currentRevision(),
        requestId: "late-rebuild",
      });
      const id = jobId(receipt);
      await vi.waitFor(() =>
        expect(h.cad.sketchSurface).toHaveBeenCalledTimes(2),
      );
      expect((await h.api.invoke("job_cancel", { jobId: id })).ok).toBe(true);
      finish(mesh("late-rebuilt-face"));
      expect((await settle(h.api, receipt)).status).toBe("cancelled");
      expect(h.state.entities).toBe(entities);
      expect(h.state.history).toBe(history);
      expect(h.state.authoring).toBe(authoring);
      expect(h.state.entities[1].kernelId).toBe("face-1");
      expect(h.cad.release).toHaveBeenCalledExactlyOnceWith([
        "late-rebuilt-face",
      ]);
    } finally {
      h.api.dispose();
    }
  });

  it("advertises the same editable sketchSurface contract in both recipe schemas and discovery", async () => {
    const h = setup();
    try {
      for (const command of ["cad_create", "cad_rebuild"]) {
        const descriptor = catalog.find((tool) => tool.name === command)!;
        const args = {
          recipe: { kind: "sketchSurface", sketch: h.input },
          expectedRevision: 0,
          requestId: command,
          ...(command === "cad_create"
            ? { name: "Face" }
            : { entityId: "face" }),
        };
        expect(() => validateInput(descriptor.inputSchema, args)).not.toThrow();
        for (const recipe of [
          { kind: "sketchSurface" },
          { kind: "sketchSurface", sketch: [] },
          { ...args.recipe, chordTolerance: 0.1 },
          { ...args.recipe, height: 1 },
        ]) {
          expect(() =>
            validateInput(descriptor.inputSchema, { ...args, recipe }),
          ).toThrow();
        }
      }
      expect(() =>
        validateInput(
          catalog.find((tool) => tool.name === "cad_create")!.inputSchema,
          { ...h.request("too-long"), name: "x".repeat(201) },
        ),
      ).toThrow();
      const discovery = await h.api.invoke("capabilities_get", {});
      expect(discovery).toMatchObject({ ok: true });
      if (!discovery.ok) return;
      const commands = (discovery.result as { commands: typeof catalog })
        .commands;
      for (const name of ["cad_create", "cad_rebuild"])
        expect(
          JSON.stringify(commands.find((tool) => tool.name === name)),
        ).toContain("sketchSurface");
    } finally {
      h.api.dispose();
    }
  });
});
