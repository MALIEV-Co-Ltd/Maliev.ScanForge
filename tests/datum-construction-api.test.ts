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
import {
  decodeProjectContents,
  encodeProjectFileLocally,
} from "../src/project-file-codec";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
} from "../src/io";
import type { Entity } from "../src/types";
import { decodeReferenceFrame } from "../src/reference-frame";

const apis: ApplicationApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
});
const input = {
  kind: "plane",
  origin: [2, 3, 4],
  normal: [0, 0, 7],
  xDirection: [0, 5, 0],
  displaySize: 10,
};
function setup(entities: Entity[] = []) {
  const state: WorkspaceSnapshot = {
    name: "Datums",
    entities,
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: null,
    selection: null,
  };
  const commit = vi.fn<WorkspaceHost["commit"]>((next, label) => {
    state.history.push({ entities: state.entities, label });
    state.entities = next;
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
    showReferenceConstructionPreview: vi.fn(),
    inspectApplication: () => ({ previews: {} }),
    setAuthoring: (authoring) => {
      state.authoring = authoring;
    },
  };
  const api = new ApplicationApi(host, {
    ...createOperations(host),
    ...createAuthoringOperations(host),
  });
  apis.push(api);
  const command = (fields: Record<string, unknown> = {}) =>
    api.invoke("datum_construct", {
      ...input,
      ...fields,
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
  return { state, host, api, command, commit };
}
async function value(
  promise: ReturnType<ApplicationApi["invoke"]>,
): Promise<any> {
  const result = await promise;
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw Error(result.error.message);
  return result.result;
}
it("discovers the implemented numeric datum kinds and creates one detached plane", async () => {
  const unrelated: Entity = {
    id: "scan",
    name: "Scan",
    kind: "mesh",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    visible: true,
    color: "#123456",
    opacity: 1,
  };
  const h = setup([unrelated]);
  const discovery = await value(
    h.api.invoke("tools_search", {
      query: "datum_construct",
      includeSchemas: true,
    }),
  );
  const tool = discovery.tools.find(
    (item: any) => item.name === "datum_construct",
  );
  expect(tool.inputSchema.properties.kind.enum).toEqual(["plane", "frame"]);
  const result = await value(h.command({ name: "Rolled datum" }));
  expect(result).toMatchObject({
    units: "mm",
    displaySize: 10,
    frame: {
      origin: [2, 3, 4],
      u: [0, 1, 0],
      v: [-1, 0, 0],
      normal: [0, 0, 1],
    },
  });
  expect(h.state.entities).toHaveLength(2);
  expect(h.state.entities[0]).toBe(unrelated);
  expect(h.state.entities[0].positions).toBe(unrelated.positions);
  const plane = h.state.entities[1];
  expect(plane).toMatchObject({
    id: result.entityId,
    name: "Rolled datum",
    kind: "plane",
    planeFrame: { center: [2, 3, 4], normal: [0, 0, 1], tangent: [0, 1, 0] },
  });
  expect(plane.fit).toBeUndefined();
  expect(plane.brep).toBeUndefined();
  expect(Array.isArray(plane.positions)).toBe(true);
  expect(plane.positions).toHaveLength(18);
  expect(h.commit).toHaveBeenCalledOnce();
  expect(h.host.select).toHaveBeenCalledWith(plane.id);
  expect(
    await value(h.api.invoke("object_get", { entityId: plane.id })),
  ).toMatchObject({ planeFrame: plane.planeFrame });
});
it("retries one creation, rejects stale and changed requests, and uses the shared default frame", async () => {
  const h = setup();
  const { xDirection: _xDirection, ...defaultInput } = input;
  const args = {
    ...defaultInput,
    expectedRevision: h.api.currentRevision(),
    requestId: "create-once",
  };
  const first = await value(h.api.invoke("datum_construct", args));
  expect(first.frame).toEqual(numericDatumFrame(input.origin, input.normal));
  expect(await value(h.api.invoke("datum_construct", args))).toEqual(first);
  expect(h.commit).toHaveBeenCalledOnce();
  expect(
    await h.api.invoke("datum_construct", { ...args, displaySize: 20 }),
  ).toMatchObject({ ok: false, error: { code: "REQUEST_CONFLICT" } });
  expect(
    await h.api.invoke("datum_construct", { ...args, requestId: "stale" }),
  ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  expect(h.commit).toHaveBeenCalledOnce();
});
it("edits numeric geometry while preserving presentation and exact single-step model undo/redo", async () => {
  const h = setup();
  const created = await value(h.command({ name: "Named datum" }));
  h.state.entities = h.state.entities.map((entity) => ({
    ...entity,
    color: "#abcdef",
    opacity: 0.25,
    visible: false,
    selectable: false,
    constructionOrderKey: "04".repeat(16),
  }));
  const before = h.state.entities;
  const result = await value(
    h.command({
      entityId: created.entityId,
      origin: [8, 9, 10],
      displaySize: 24,
    }),
  );
  expect(result.entityId).toBe(created.entityId);
  expect(result.frame.origin).toEqual([8, 9, 10]);
  expect(h.state.entities[0]).toMatchObject({
    id: created.entityId,
    name: "Named datum",
    color: "#abcdef",
    opacity: 0.25,
    visible: false,
    selectable: false,
    constructionOrderKey: "04".repeat(16),
  });
  expect(h.state.entities[0].positions).not.toBe(before[0].positions);
  expect(before[0].planeFrame!.center).toEqual([2, 3, 4]);
  expect(h.state.history).toHaveLength(2);
  const after = h.state.entities;
  await value(
    h.api.invoke("history_undo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "undo-datum",
    }),
  );
  expect(h.state.entities).toBe(before);
  await value(
    h.api.invoke("history_redo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "redo-datum",
    }),
  );
  expect(h.state.entities).toBe(after);
});
it.each([
  {
    fields: { kind: "coordinateSystem" },
    code: "INVALID_ARGUMENT",
    message: /kind.*unsupported/i,
  },
  {
    fields: { origin: [0, 0] },
    code: "INVALID_ARGUMENT",
    message: /origin.*few/i,
  },
  {
    fields: { origin: [NaN, 0, 0] },
    code: "INVALID_ARGUMENT",
    message: /origin.*finite/i,
  },
  {
    fields: { origin: [1e9 + 1, 0, 0] },
    code: "INVALID_ARGUMENT",
    message: /origin.*maximum/i,
  },
  {
    fields: { normal: [0, 0, 0] },
    code: "OPERATION_FAILED",
    message: /direction.*nonzero/i,
  },
  {
    fields: { normal: ["0", 0, 1] },
    code: "INVALID_ARGUMENT",
    message: /normal.*finite/i,
  },
  {
    fields: { xDirection: [0, 0, 3] },
    code: "OPERATION_FAILED",
    message: /parallel/i,
  },
  {
    fields: { xDirection: [0, 0, 0] },
    code: "OPERATION_FAILED",
    message: /direction.*nonzero/i,
  },
  {
    fields: { displaySize: 0 },
    code: "INVALID_ARGUMENT",
    message: /displaySize.*exceed/i,
  },
  {
    fields: { displaySize: 2e9 + 1 },
    code: "INVALID_ARGUMENT",
    message: /displaySize.*maximum/i,
  },
  {
    fields: { displaySize: Infinity },
    code: "INVALID_ARGUMENT",
    message: /displaySize.*finite/i,
  },
  {
    fields: { name: "x".repeat(201) },
    code: "INVALID_ARGUMENT",
    message: /name.*long/i,
  },
  {
    fields: { name: "   " },
    code: "OPERATION_FAILED",
    message: /name.*1 to 200/i,
  },
  {
    fields: { origin: [1e9, 0, 0] },
    code: "OPERATION_FAILED",
    message: /coordinates.*1e9/i,
  },
  {
    fields: { extra: true },
    code: "INVALID_ARGUMENT",
    message: /unknown field extra/i,
  },
])(
  "rejects malformed or unrepresentable numeric datums atomically: %j",
  async ({ fields, code, message }) => {
    const h = setup();
    const before = h.state.entities;
    expect(await h.command(fields)).toMatchObject({
      ok: false,
      error: { code, message: expect.stringMatching(message) },
    });
    expect(h.state.entities).toBe(before);
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.host.select).not.toHaveBeenCalled();
  },
);
it.each([
  "missing",
  "locked",
  "fit",
  "cad",
  "kernel",
  "parametric",
  "no-frame",
  "rename",
])("rejects an ineligible %s edit without losing geometry", async (kind) => {
  const plane = createNumericDatumPlane(
    numericDatumFrame([0, 0, 0], [0, 0, 1]),
    10,
    "plane",
    "Original",
  );
  if (kind === "locked") plane.locked = true;
  if (kind === "fit")
    plane.fit = {
      kind: "plane",
      center: [0, 0, 0],
      axis: [0, 0, 1],
      rms: 0,
      maxError: 0,
    };
  if (kind === "cad") plane.kind = "cad";
  if (kind === "kernel") plane.kernelId = "owned-elsewhere";
  if (kind === "parametric") plane.parametric = {} as Entity["parametric"];
  if (kind === "no-frame") delete plane.planeFrame;
  const h = setup([plane]);
  const before = h.state.entities;
  expect(
    await h.command({
      entityId: kind === "missing" ? "missing" : plane.id,
      ...(kind === "rename" ? { name: "Renamed" } : {}),
    }),
  ).toMatchObject({
    ok: false,
    error: {
      code: "OPERATION_FAILED",
      message: expect.stringMatching(
        kind === "missing"
          ? /does not exist/i
          : kind === "locked"
            ? /locked/i
            : kind === "rename"
              ? /object_update.*rename/i
              : /numeric plane.*stored plane frame/i,
      ),
    },
  });
  expect(h.state.entities).toBe(before);
  expect(h.commit).not.toHaveBeenCalled();
});
it("preserves an owning reference preview when numeric datum construction competes", async () => {
  const h = setup();
  const owner = await value(
    h.api.invoke("reference_construct", {
      action: "preview",
      kind: "point",
      position: [1, 2, 3],
      expectedRevision: h.api.currentRevision(),
      requestId: "preview-owner",
    }),
  );
  expect(await h.command()).toMatchObject({
    ok: false,
    error: { code: "BUSY" },
  });
  expect(
    await value(h.api.invoke("reference_construction_get", {})),
  ).toMatchObject({
    active: true,
    sessionId: owner.sessionId,
    version: owner.version,
  });
  expect(h.commit).not.toHaveBeenCalled();
});
it("preserves plane frames and full precision through JSON/blob and binary history/future reopen", async () => {
  const h = setup();
  const created = await value(
    h.command({
      origin: [100000000.125, -20, 30],
      normal: [1, 2, 3],
      xDirection: [4, -1, 0],
      displaySize: 0.125,
    }),
  );
  await value(h.command({ entityId: created.entityId, origin: [7, 8, 9] }));
  await value(
    h.api.invoke("history_undo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "undo-for-future",
    }),
  );
  const project = {
    format: "maliev-scanforge" as const,
    version: 1 as const,
    name: "Datums",
    units: "mm" as const,
    entities: h.state.entities,
  };
  for (const text of [
    serializeProject(project.name, project.entities),
    await (await serializeProjectBlob(project.name, project.entities)).text(),
  ])
    expect(parseProject(text).entities).toEqual(project.entities);
  const session = { project, history: h.state.history, future: h.state.future };
  const restored = await decodeProjectContents(
    await encodeProjectFileLocally(session),
  );
  expect(restored.project.entities).toEqual(project.entities);
  expect(restored.history).toEqual(session.history);
  expect(restored.future).toEqual(session.future);
});
it("creates a sketch from the numeric plane through the existing shared placement operation", async () => {
  const h = setup();
  const plane = await value(h.command());
  const result = await value(
    h.api.invoke("sketch_manage", {
      action: "create",
      name: "On numeric plane",
      planeSourceId: plane.entityId,
      normalOffset: -2,
      expectedRevision: h.api.currentRevision(),
      requestId: "numeric-plane-sketch",
    }),
  );
  expect(result.frame).toEqual({ ...plane.frame, origin: [2, 3, 2] });
  expect(h.state.authoring.sketches![0].sketch.frame).toEqual(result.frame);
  expect(h.commit).toHaveBeenCalledOnce();
});
it("creates and inspects a real named coordinate frame without triangle geometry or aliased responses", async () => {
  const h = setup();
  const created = await value(
    h.command({ kind: "frame", name: "Fixture frame" }),
  );
  expect(created).toMatchObject({
    units: "mm",
    displaySize: 10,
    frame: numericDatumFrame(input.origin, input.normal, input.xDirection),
  });
  const entity = h.state.entities[0];
  expect(entity).toMatchObject({
    id: created.entityId,
    name: "Fixture frame",
    kind: "referenceFrame",
    positions: [],
    coordinateFrame: { version: 1, frame: created.frame, displaySize: 10 },
  });
  expect(entity.fit).toBeUndefined();
  expect(entity.planeFrame).toBeUndefined();
  expect(entity.kernelId).toBeUndefined();
  const inspected = await value(
    h.api.invoke("object_get", { entityId: entity.id }),
  );
  const project = await value(h.api.invoke("project_get", {}));
  for (const result of [inspected, project.objects[0]]) {
    expect(result).toMatchObject({
      kind: "referenceFrame",
      points: 1,
      lines: 3,
      triangles: 0,
      exactCad: false,
      hasBrep: false,
      coordinateFrame: entity.coordinateFrame,
    });
    expect(result.coordinateFrameEncoding.frameBits).toMatch(/^[0-9a-f]{192}$/);
    result.coordinateFrame.frame.origin[0] = 999;
    expect(entity.coordinateFrame!.frame.origin[0]).toBe(2);
  }
  created.frame.origin[0] = 500;
  expect(entity.coordinateFrame!.frame.origin[0]).toBe(2);
  expect(h.commit).toHaveBeenCalledOnce();
});
it("rejects coordinate frames whose positive display axes leave the world bounds", async () => {
  const h = setup();
  expect(await h.command({ kind: "frame", origin: [0, 1e9, 0] })).toMatchObject(
    {
      ok: false,
      error: {
        code: "OPERATION_FAILED",
        message: expect.stringMatching(/axis endpoints.*world bounds/i),
      },
    },
  );
  expect(h.state.entities).toEqual([]);
  expect(h.commit).not.toHaveBeenCalled();
});
it("reads authoritative coordinate-frame geometry and binary64 encoding through the public artifact API", async () => {
  const h = setup();
  const created = await value(
    h.command({
      kind: "frame",
      origin: [-0, 2.0000000000000004, 3],
      displaySize: 10.000000000000002,
    }),
  );
  const before = h.state.entities;
  const revision = h.api.currentRevision();
  const inspected = await value(
    h.api.invoke("object_get", {
      entityId: created.entityId,
      includeGeometry: true,
    }),
  );
  const chunk = await value(
    h.api.invoke("artifact_read", {
      artifactId: inspected.geometry.artifactId,
    }),
  );
  expect(chunk.eof).toBe(true);
  const geometry = JSON.parse(atob(chunk.base64));
  expect(geometry).toMatchObject({
    units: "mm",
    coordinateFrame: { version: 1, displaySize: 10.000000000000002 },
  });
  expect(geometry.coordinateFrame.frame).toEqual({
    ...created.frame,
    origin: [0, 2.0000000000000004, 3],
  });
  expect(geometry.coordinateFrameEncoding).toEqual(
    inspected.coordinateFrameEncoding,
  );
  expect(decodeReferenceFrame(geometry.coordinateFrameEncoding)).toEqual(
    before[0].coordinateFrame,
  );
  expect(
    Object.is(
      decodeReferenceFrame(geometry.coordinateFrameEncoding).frame.origin[0],
      -0,
    ),
  ).toBe(true);
  expect(geometry).not.toHaveProperty("positions");
  expect(geometry).not.toHaveProperty("indexedMesh");
  expect(geometry).not.toHaveProperty("normals");
  expect(h.state.entities).toBe(before);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.commit).toHaveBeenCalledOnce();
});
it("edits coordinate frames in one exact reversible history step and preserves retry and presentation identity", async () => {
  const h = setup();
  const created = await value(h.command({ kind: "frame" }));
  h.state.entities = h.state.entities.map((entity) => ({
    ...entity,
    name: "Retained frame",
    color: "#abcdef",
    opacity: 0.4,
    visible: false,
    selectable: false,
    constructionOrderKey: "05".repeat(16),
  }));
  const before = h.state.entities;
  const args = {
    ...input,
    kind: "frame",
    entityId: created.entityId,
    origin: [8, 9, 10],
    displaySize: 22,
    expectedRevision: h.api.currentRevision(),
    requestId: "edit-frame-once",
  };
  const result = await value(h.api.invoke("datum_construct", args));
  expect(result).toMatchObject({
    entityId: created.entityId,
    displaySize: 22,
    frame: { origin: [8, 9, 10] },
  });
  expect(h.state.entities[0]).toMatchObject({
    id: created.entityId,
    name: "Retained frame",
    color: "#abcdef",
    opacity: 0.4,
    visible: false,
    selectable: false,
    constructionOrderKey: "05".repeat(16),
    coordinateFrame: { displaySize: 22 },
  });
  expect(before[0].coordinateFrame!.frame.origin).toEqual([2, 3, 4]);
  expect(await value(h.api.invoke("datum_construct", args))).toEqual(result);
  expect(h.commit).toHaveBeenCalledTimes(2);
  expect(
    await h.api.invoke("datum_construct", {
      ...args,
      requestId: "frame-stale",
    }),
  ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  const after = h.state.entities;
  await value(
    h.api.invoke("history_undo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "undo-frame",
    }),
  );
  expect(h.state.entities).toBe(before);
  await value(
    h.api.invoke("history_redo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "redo-frame",
    }),
  );
  expect(h.state.entities).toBe(after);
});
it("rejects locked frame edits, frame/plane kind changes and edit-time rename atomically", async () => {
  const h = setup();
  const created = await value(h.command({ kind: "frame" }));
  for (const fields of [{ name: "Renamed" }, { kind: "plane" }]) {
    const before = h.state.entities;
    expect(
      await h.command({ kind: "frame", entityId: created.entityId, ...fields }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "OPERATION_FAILED",
        message: expect.stringMatching(
          fields.name ? /object_update.*rename/i : /numeric plane/i,
        ),
      },
    });
    expect(h.state.entities).toBe(before);
  }
  h.state.entities = h.state.entities.map((entity) => ({
    ...entity,
    locked: true,
  }));
  const before = h.state.entities;
  expect(
    await h.command({ kind: "frame", entityId: created.entityId }),
  ).toMatchObject({
    ok: false,
    error: {
      code: "OPERATION_FAILED",
      message: expect.stringMatching(/locked/i),
    },
  });
  expect(h.state.entities).toBe(before);
  expect(h.commit).toHaveBeenCalledOnce();
  const plane = await value(h.command());
  expect(
    await h.command({ kind: "frame", entityId: plane.entityId }),
  ).toMatchObject({
    ok: false,
    error: {
      code: "OPERATION_FAILED",
      message: expect.stringMatching(/coordinate frame/i),
    },
  });
  expect(h.commit).toHaveBeenCalledTimes(2);
});
it("keeps frame construction out of owned reference previews and pending display cleanup", async () => {
  const h = setup();
  const owner = await value(
    h.api.invoke("reference_construct", {
      action: "preview",
      kind: "point",
      position: [1, 2, 3],
      expectedRevision: h.api.currentRevision(),
      requestId: "frame-preview-owner",
    }),
  );
  expect(await h.command({ kind: "frame" })).toMatchObject({
    ok: false,
    error: { code: "BUSY" },
  });
  expect(
    await value(h.api.invoke("reference_construction_get", {})),
  ).toMatchObject({ active: true, sessionId: owner.sessionId });
  await value(
    h.api.invoke("reference_construct", {
      action: "cancel",
      sessionId: owner.sessionId,
      version: owner.version,
      expectedRevision: h.api.currentRevision(),
      requestId: "cancel-frame-owner",
    }),
  );
  h.host.inspectApplication = () => ({
    previews: { referenceConstruction: true },
  });
  expect(await h.command({ kind: "frame" })).toMatchObject({
    ok: false,
    error: { code: "BUSY" },
  });
  expect(h.state.entities).toEqual([]);
  expect(h.commit).not.toHaveBeenCalled();
});
it("preserves exact coordinate-frame payloads in current/history/future through JSON/blob/binary reopening", async () => {
  const h = setup();
  const created = await value(
    h.command({
      kind: "frame",
      origin: [-0, 2.0000000000000004, 3],
      displaySize: 10.000000000000002,
    }),
  );
  await value(
    h.command({
      kind: "frame",
      entityId: created.entityId,
      origin: [8, 9, 10],
      displaySize: 12,
    }),
  );
  await value(
    h.api.invoke("history_undo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "frame-future",
    }),
  );
  const project = {
    format: "maliev-scanforge" as const,
    version: 1 as const,
    units: "mm" as const,
    name: "Frames",
    entities: h.state.entities,
  };
  for (const text of [
    serializeProject(project.name, project.entities),
    await (await serializeProjectBlob(project.name, project.entities)).text(),
  ]) {
    const restored = parseProject(text);
    expect(restored.entities).toEqual(project.entities);
    expect(
      Object.is(restored.entities[0].coordinateFrame!.frame.origin[0], -0),
    ).toBe(true);
  }
  const session = { project, history: h.state.history, future: h.state.future };
  const restored = await decodeProjectContents(
    await encodeProjectFileLocally(session),
  );
  expect(restored.project.entities).toEqual(project.entities);
  expect(restored.history).toEqual(session.history);
  expect(restored.future).toEqual(session.future);
});
it.each([
  { command: "analysis_fit", fields: { kind: "plane" } },
  {
    command: "mesh_transform",
    fields: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  },
  { command: "mesh_copy", fields: {} },
  { command: "selection_set", fields: { triangles: [] } },
])(
  "rejects sampled geometry tool $command on coordinate frames",
  async ({ command, fields }) => {
    const h = setup();
    const frame = await value(h.command({ kind: "frame" }));
    const before = h.state.entities;
    const revision = h.api.currentRevision();
    const pending = h.api.invoke(command, {
      entityId: frame.entityId,
      ...fields,
      ...(command === "analysis_fit"
        ? {}
        : {
            expectedRevision: revision,
            requestId: `frame-${command}`,
          }),
    });
    const error = {
      code: "OPERATION_FAILED",
      message: expect.stringMatching(/sampled.*geometry/i),
    };
    if (command === "analysis_fit") {
      const { jobId } = await value(pending);
      let job: any;
      for (let attempt = 0; attempt < 20; attempt++) {
        job = await value(h.api.invoke("job_get", { jobId }));
        if (job.status !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(job).toMatchObject({ status: "failed", error });
      expect(job.result).toBeUndefined();
      expect((await value(h.api.invoke("session_get", {}))).artifacts).toEqual(
        [],
      );
    } else {
      expect(await pending).toMatchObject({ ok: false, error });
    }
    expect(h.state.entities).toBe(before);
    expect(h.api.currentRevision()).toBe(revision);
    expect(h.commit).toHaveBeenCalledOnce();
  },
);
it("deletes a coordinate frame through shared object deletion with exact history recovery", async () => {
  const h = setup();
  const frame = await value(h.command({ kind: "frame" }));
  const before = h.state.entities;
  await value(
    h.api.invoke("object_delete", {
      entityId: frame.entityId,
      expectedRevision: h.api.currentRevision(),
      requestId: "delete-frame",
    }),
  );
  expect(h.state.entities).toEqual([]);
  expect(h.commit).toHaveBeenCalledTimes(2);
  await value(
    h.api.invoke("history_undo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "undo-frame-delete",
    }),
  );
  expect(h.state.entities).toBe(before);
});
it.each([
  {
    framePlane: "XY",
    origin: [2, 3, 2],
    u: [0, 1, 0],
    v: [-1, 0, 0],
    normal: [0, 0, 1],
  },
  {
    framePlane: "YZ",
    origin: [2, 1, 4],
    u: [-1, 0, 0],
    v: [0, 0, 1],
    normal: [0, 1, 0],
  },
  {
    framePlane: "XZ",
    origin: [4, 3, 4],
    u: [0, 0, 1],
    v: [0, 1, 0],
    normal: [-1, 0, 0],
  },
])(
  "creates a detached sketch on coordinate-frame $framePlane with the correct signed normal",
  async ({ framePlane, ...expected }) => {
    const h = setup();
    const frame = await value(h.command({ kind: "frame" }));
    const result = await value(
      h.api.invoke("sketch_manage", {
        action: "create",
        name: `${framePlane} frame sketch`,
        planeSourceId: frame.entityId,
        framePlane,
        normalOffset: -2,
        expectedRevision: h.api.currentRevision(),
        requestId: `frame-sketch-${framePlane}`,
      }),
    );
    expect(result.frame).toEqual(expected);
    await value(
      h.command({
        kind: "frame",
        entityId: frame.entityId,
        origin: [100, 100, 100],
      }),
    );
    expect(h.state.authoring.sketches![0].sketch.frame).toEqual(expected);
  },
);
