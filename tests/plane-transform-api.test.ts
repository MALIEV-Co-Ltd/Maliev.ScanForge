import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { createAuthoringOperations } from "../src/automation/authoring-operations";
import {
  createNumericDatumPlane,
  numericDatumFrame,
} from "../src/datum-construction";
import { createFittedPlane } from "../src/primitive-fitting";
import { validatePlaneFrame } from "../src/plane-frame";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
} from "../src/io";
import {
  decodeProjectContents,
  encodeProjectFileLocally,
} from "../src/project-file-codec";
import type { Entity } from "../src/types";

const apis: ApplicationApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
});
function fixture(fitted = false): Entity {
  return fitted
    ? createFittedPlane(
        {
          kind: "plane",
          center: [2, 3, 4],
          axis: [0, 0, 1],
          rms: 0.0125,
          maxError: 0.04,
        },
        10,
        "Fitted datum",
      )
    : createNumericDatumPlane(
        numericDatumFrame([2, 3, 4], [0, 0, 1], [0, 1, 0]),
        10,
        "plane",
        "Numeric datum",
      );
}
function setup(source = fixture()) {
  const state: WorkspaceSnapshot = {
    name: "Plane transform",
    entities: [source],
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: source.id,
    selection: null,
  };
  const commit = vi.fn<WorkspaceHost["commit"]>((entities, label) => {
    state.history.push({ entities: state.entities, label });
    state.entities = entities;
    state.future = [];
  });
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => {
      throw Error("No CAD required");
    },
    commit,
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
    undo: () => {
      const row = state.history.pop()!;
      state.future.push({ entities: state.entities, label: row.label });
      state.entities = row.entities;
    },
    redo: () => {
      const row = state.future.pop()!;
      state.history.push({ entities: state.entities, label: row.label });
      state.entities = row.entities;
    },
    setAuthoring: (authoring) => {
      state.authoring = authoring;
    },
  };
  const api = new ApplicationApi(host, {
    ...createOperations(host),
    ...createAuthoringOperations(host),
  });
  apis.push(api);
  const transform = (fields: Record<string, unknown> = {}) =>
    api.invoke("mesh_transform", {
      entityId: source.id,
      translation: [10, -5, 2],
      rotation: [0, 90, 0],
      scale: 2,
      ...fields,
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
  return { api, state, source, commit, transform };
}
async function value(
  promise: ReturnType<ApplicationApi["invoke"]>,
): Promise<any> {
  const result = await promise;
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw Error(result.error.message);
  return result.result;
}
async function completed(
  api: ApplicationApi,
  command: string,
  args: Record<string, unknown>,
) {
  const { jobId } = await value(api.invoke(command, args));
  let job: any;
  for (let attempt = 0; attempt < 20; attempt++) {
    job = await value(api.invoke("job_get", { jobId }));
    if (job.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  expect(job.status, JSON.stringify(job)).toBe("succeeded");
  return job.result;
}
function near(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((number, index) =>
    expect(actual[index]).toBeCloseTo(number, 10),
  );
}
it.each([false, true])(
  "preserves a transformed %s-fitted plane as an editable datum and clears stale fit diagnostics",
  async (fitted) => {
    const h = setup(fixture(fitted));
    const before = h.state.entities;
    const oldPositions = Array.from(h.source.positions);
    const oldFrame = structuredClone(h.source.planeFrame!);
    const oldFit = h.source.fit;
    const args = {
      entityId: h.source.id,
      translation: [10, -5, 2],
      rotation: [0, 90, 0],
      scale: 2,
      expectedRevision: h.api.currentRevision(),
      requestId: "transform-once",
    };
    await value(h.api.invoke("mesh_transform", args));
    const transformed = h.state.entities[0];
    expect(transformed.kind).toBe("plane");
    expect(transformed.fit).toBeUndefined();
    expect(transformed.id).toBe(h.source.id);
    expect(transformed.name).toBe(h.source.name);
    expect(transformed.color).toBe(h.source.color);
    near(transformed.planeFrame!.center, [18, 1, -2]);
    near(transformed.planeFrame!.normal, [1, 0, 0]);
    near(transformed.planeFrame!.tangent, fitted ? [0, 0, -1] : [0, 1, 0]);
    expect(() =>
      validatePlaneFrame(
        transformed.planeFrame,
        transformed.positions,
        transformed.kind,
      ),
    ).not.toThrow();
    expect(Array.from(h.source.positions)).toEqual(oldPositions);
    expect(h.source.planeFrame).toEqual(oldFrame);
    expect(h.source.fit).toBe(oldFit);
    expect(transformed.positions).not.toBe(h.source.positions);
    const revision = h.api.currentRevision();
    expect(await value(h.api.invoke("mesh_transform", args))).toEqual({
      entityId: h.source.id,
      refreshedEntityIds: [],
      evaluations: [],
    });
    expect(h.commit).toHaveBeenCalledOnce();
    expect(
      await h.api.invoke("mesh_transform", {
        ...args,
        requestId: "stale-plane-transform",
      }),
    ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
    expect(h.api.currentRevision()).toBe(revision);
    const inspected = await value(
      h.api.invoke("object_get", { entityId: h.source.id }),
    );
    expect(inspected).toMatchObject({
      kind: "plane",
      planeFrame: transformed.planeFrame,
    });
    expect(inspected.fit).toBeUndefined();
    const references = await completed(h.api, "alignment_references", {
      entityId: h.source.id,
    });
    expect(references.references).toHaveLength(1);
    expect(references.references[0]).toMatchObject({
      id: `${h.source.id}/plane/XY`,
      kind: "plane",
      source: "referenceConstruction",
    });
    near(references.references[0].point, [18, 1, -2]);
    near(references.references[0].direction, [1, 0, 0]);
    const sketch = await value(
      h.api.invoke("sketch_manage", {
        action: "create",
        name: "After transform",
        planeSourceId: h.source.id,
        normalOffset: 3,
        expectedRevision: h.api.currentRevision(),
        requestId: "transformed-plane-sketch",
      }),
    );
    near(sketch.frame.origin, [21, 1, -2]);
    near(sketch.frame.normal, [1, 0, 0]);
    near(sketch.frame.u, transformed.planeFrame!.tangent);
    const after = h.state.entities;
    for (const text of [
      serializeProject("Transformed plane", after),
      await (await serializeProjectBlob("Transformed plane", after)).text(),
    ]) {
      const restored = parseProject(text).entities[0];
      expect(restored.kind).toBe("plane");
      expect(restored.planeFrame).toEqual(transformed.planeFrame);
      expect(restored.fit).toBeUndefined();
    }
    await value(
      h.api.invoke("history_undo", {
        expectedRevision: h.api.currentRevision(),
        requestId: "undo-transform",
      }),
    );
    expect(h.state.entities).toBe(before);
    expect(h.state.entities[0].fit).toBe(oldFit);
    const session = {
      project: {
        format: "maliev-scanforge" as const,
        version: 1 as const,
        units: "mm" as const,
        name: "Plane history",
        entities: h.state.entities,
      },
      history: h.state.history,
      future: h.state.future,
    };
    const restored = await decodeProjectContents(
      await encodeProjectFileLocally(session),
    );
    expect(restored.project.entities).toEqual(before);
    expect(restored.future[0].entities).toEqual(after);
    expect(h.state.authoring.sketches![0].sketch.frame).toEqual(sketch.frame);
    await value(
      h.api.invoke("history_redo", {
        expectedRevision: h.api.currentRevision(),
        requestId: "redo-transform",
      }),
    );
    expect(h.state.entities).toBe(after);
  },
);
it.each([
  { kind: "locked", message: /locked/i },
  { kind: "center-bounds", message: /plane frame|world bounds/i },
  { kind: "vertex-bounds", message: /world bounds/i },
  { kind: "invalid-frame", message: /plane frame.*geometry/i },
])(
  "rejects $kind plane transformations without publishing or losing the datum",
  async ({ kind, message }) => {
    const source = fixture();
    if (kind === "locked") source.locked = true;
    if (kind === "invalid-frame") source.planeFrame!.center[2] += 1;
    const h = setup(source),
      before = h.state.entities,
      revision = h.api.currentRevision();
    const fields =
      kind === "center-bounds"
        ? { translation: [1e9, 0, 0], rotation: [0, 0, 0], scale: 1 }
        : kind === "vertex-bounds"
          ? { translation: [1e9 - 2, 0, 0], rotation: [0, 0, 0], scale: 1 }
          : {};
    expect(await h.transform(fields)).toMatchObject({
      ok: false,
      error: {
        code: "OPERATION_FAILED",
        message: expect.stringMatching(message),
      },
    });
    expect(h.state.entities).toBe(before);
    expect(h.state.history).toEqual([]);
    expect(h.api.currentRevision()).toBe(revision);
    expect(h.commit).not.toHaveBeenCalled();
  },
);
it("keeps the existing raw-mesh transform behavior and immutable source buffers", async () => {
  const source: Entity = {
    id: "mesh",
    name: "Raw mesh",
    kind: "mesh",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    visible: true,
    color: "#123456",
    opacity: 0.6,
  };
  const h = setup(source),
    before = [...source.positions];
  await value(
    h.transform({ translation: [1, 2, 3], rotation: [0, 0, 90], scale: 2 }),
  );
  const transformed = h.state.entities[0];
  expect(transformed.kind).toBe("mesh");
  expect(transformed.planeFrame).toBeUndefined();
  expect(transformed.fit).toBeUndefined();
  near(Array.from(transformed.positions), [1, 2, 3, 1, 4, 3, -1, 2, 3]);
  expect(source.positions).toEqual(before);
  expect(h.commit).toHaveBeenCalledOnce();
});
