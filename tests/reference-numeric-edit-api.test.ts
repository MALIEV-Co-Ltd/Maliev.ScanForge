// Shared inspection/initialization contract; parent captured RED before implementation.
import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { lockedObjectEdit } from "../src/object-operations";
import { encodeReferenceEntityData } from "../src/reference-entity";
import { encodeReferenceGeometry } from "../src/reference-construction-values";
import { serializeProject, parseProject } from "../src/io";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
} from "../src/project-file-codec";
import type { Entity, Vec3 } from "../src/types";

const apis: ApplicationApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function point(position: Vec3 = [-0, 0.00781254, 1000.000244140625]): Entity {
  return {
    id: "p",
    name: "Precise point",
    kind: "referencePoint",
    positions: [],
    visible: true,
    color: "#ffffff",
    opacity: 1,
    constructionOrderKey: "01".repeat(16),
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "point",
        mode: "coordinates",
        position,
        sources: [],
      },
      geometry: { kind: "point", position },
      evaluation: { completionWord: 256 },
    },
  };
}
function line(start: Vec3 = [0.00781254, 0, 0], length = 1): Entity {
  const end: Vec3 = [start[0] + length, start[1], start[2]];
  return {
    ...point(),
    id: "l",
    name: "Precise line",
    kind: "referenceLine",
    constructionOrderKey: "02".repeat(16),
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "line",
        mode: "endpoints",
        start,
        end,
        sources: [],
        records: [],
      },
      geometry: { kind: "line", start, direction: [1, 0, 0], length },
      evaluation: { completionWord: 256 },
    },
  };
}
function fixture(entities = [point(), line()]) {
  const state: WorkspaceSnapshot = {
    name: "Numeric edit initialization",
    entities,
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: null,
    selection: null,
  };
  const display = vi.fn();
  const commit = vi.fn<WorkspaceHost["commit"]>((next, label, policy) => {
    if (lockedObjectEdit(state.entities, next, policy))
      throw Error("Locked geometry edit");
    state.history.push({ entities: state.entities, label });
    state.entities = next;
    state.future = [];
  });
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => {
      throw Error("No CAD in numeric edit fixture");
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
    showReferenceConstructionPreview: display,
    inspectApplication: () => ({ previews: {} }),
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
  };
  const api = new ApplicationApi(host, createOperations(host));
  apis.push(api);
  const command = (args: Record<string, unknown>) =>
    api.invoke("reference_construct", {
      ...args,
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
  return { state, host, api, commit, display, command };
}
type Fixture = ReturnType<typeof fixture>;
async function value(
  promise: ReturnType<ApplicationApi["invoke"]>,
): Promise<any> {
  const receipt = await promise;
  expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
  if (!receipt.ok) throw Error(receipt.error.message);
  return receipt.result;
}
const find = (h: Fixture, id: string) =>
  h.state.entities.find((row) => row.id === id)!;
const pointEncoding = (position: Vec3) =>
  encodeReferenceGeometry({ kind: "point", position });
async function initialize(
  h: Fixture,
  kind: "point" | "line" = "point",
  entityId = kind === "point" ? "p" : "l",
) {
  return value(
    h.command({ action: "preview", kind, entityId, initialize: true }),
  );
}
async function apply(h: Fixture, p: any) {
  return value(
    h.command({ action: "apply", sessionId: p.sessionId, version: p.version }),
  );
}
async function cancel(h: Fixture, p: any) {
  return value(
    h.command({ action: "cancel", sessionId: p.sessionId, version: p.version }),
  );
}
async function history(h: Fixture, direction: "undo" | "redo") {
  return value(
    h.api.invoke(`history_${direction}`, {
      expectedRevision: h.api.currentRevision(),
      requestId: crypto.randomUUID(),
    }),
  );
}

it("discovers an explicit existing-edit initialization intent without exposing text policy knobs or raw input bits", async () => {
  const h = fixture();
  const result = await value(
    h.api.invoke("tools_search", {
      query: "reference_construct",
      includeSchemas: true,
      limit: 20,
    }),
  );
  const schema = result.tools.find(
    (row: any) => row.name === "reference_construct",
  ).inputSchema;
  expect(schema.properties.initialize).toMatchObject({ type: "boolean" });
  for (const forbidden of [
    "editorInputs",
    "precision",
    "roundingMode",
    "positionBits",
    "prior",
  ])
    expect(schema.properties[forbidden]).toBeUndefined();
});

it("inspects prepared edit fields separately from accepted point bits without preview, revision or history changes", async () => {
  const h = fixture(),
    before = h.state.entities,
    revision = h.api.currentRevision();
  const receipt = await h.api.invoke("object_get", { entityId: "p" });
  expect(receipt).toMatchObject({ ok: true, revision });
  if (!receipt.ok) throw Error(receipt.error.message);
  const result = receipt.result as any;
  expect(result.reference.geometryEncoding).toEqual(
    pointEncoding([-0, 0.00781254, 1000.000244140625]),
  );
  expect(result.reference.editorInputs).toEqual({
    kind: "point",
    units: "mm",
    coordinateSpace: "world",
    position: [0, 0.007812, 1000.000244],
    positionEncoding: pointEncoding([0, 0.007812, 1000.000244]),
  });
  result.reference.editorInputs.position[0] = 99;
  expect(
    (await value(h.api.invoke("object_get", { entityId: "p" }))).reference
      .editorInputs.position[0],
  ).toBe(0);
  expect(h.state.entities).toBe(before);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.state.history).toHaveLength(0);
  expect(h.display).not.toHaveBeenCalled();
});

it("exposes the same prepared semantic inputs in project_get summaries", async () => {
  const h = fixture();
  const objects = await value(h.api.invoke("project_get", {}));
  // project_get's existing object collection is authoritative; no new list route.
  const rows = objects.objects;
  expect(
    rows.find((row: any) => row.id === "p").reference.editorInputs
      .positionEncoding,
  ).toEqual(pointEncoding([0, 0.007812, 1000.000244]));
  expect(
    rows.find((row: any) => row.id === "l").reference.editorInputs.start,
  ).toEqual([0.007813, 0, 0]);
});

it("keeps accepted saved geometry inspectable when only numeric edit preparation exceeds its bounds", async () => {
  const source = point([1e10, 2, 3]),
    h = fixture([source]),
    before = h.state.entities;
  const inspected = await value(h.api.invoke("object_get", { entityId: "p" }));
  expect(inspected.reference.geometryEncoding).toEqual(
    pointEncoding([1e10, 2, 3]),
  );
  expect(inspected.reference.editorInputs).toBeUndefined();
  expect(inspected.reference.editorInputsError).toMatch(/1e9|bound|finite/i);
  const project = await value(h.api.invoke("project_get", {}));
  expect(project.objects[0].reference.editorInputsError).toBe(
    inspected.reference.editorInputsError,
  );
  expect(
    await h.command({
      action: "preview",
      kind: "point",
      entityId: "p",
      initialize: true,
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/1e9|bound|finite/i) },
  });
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toHaveLength(0);
  expect(h.display).not.toHaveBeenCalled();
});

it("initializes an existing numeric point server-side so a JSON caller need not retransmit signed-zero-sensitive raw coordinates", async () => {
  const h = fixture(),
    before = h.state.entities,
    revision = h.api.currentRevision();
  const p = await initialize(h);
  expect(p.definition).toMatchObject({
    kind: "point",
    mode: "coordinates",
    position: [0, 0.007812, 1000.000244],
    sources: [],
  });
  expect(p.geometryEncoding).toEqual(pointEncoding([0, 0.007812, 1000.000244]));
  expect(
    (await value(h.api.invoke("reference_construction_get", {})))
      .geometryEncoding,
  ).toEqual(p.geometryEncoding);
  expect(h.state.entities).toBe(before);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.state.history).toHaveLength(0);
  const made = await apply(h, p);
  expect(made.entityId).toBe("p");
  expect(encodeReferenceEntityData(find(h, "p").reference!).geometry).toEqual(
    p.geometryEncoding,
  );
  expect(h.state.history).toHaveLength(1);
});

it("initializes line endpoints with direct fixed6 and preserves inactive records without restoring dependencies", async () => {
  const h = fixture();
  const source = find(h, "l");
  if (source.reference!.definition.kind !== "line")
    throw Error("Expected line");
  const records = [
    {
      entityId: "missing-inactive",
      storage: "native-pick-record-f32" as const,
      coordinates: [1, 2, 3] as const,
    },
  ];
  source.reference!.definition = { ...source.reference!.definition, records };
  const p = await initialize(h, "line");
  expect(p.definition).toMatchObject({
    kind: "line",
    mode: "endpoints",
    start: [0.007813, 0, 0],
    end: [1.007813, 0, 0],
    sources: [],
    records,
  });
  const made = await apply(h, p);
  expect(find(h, made.entityId).reference!.definition).toEqual(p.definition);
  expect(h.state.history).toHaveLength(1);
});

it("initializes only actual existing edit destinations, not an owned new-object typed seed", async () => {
  const h = fixture();
  const p = await value(
    h.command({
      action: "preview",
      kind: "line",
      start: [2, 3, 4],
      end: [12, 3, 4],
    }),
  );
  expect(
    await h.command({
      action: "preview",
      kind: "line",
      initialize: true,
      sessionId: p.sessionId,
      version: p.version,
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/existing|edit destination/i) },
  });
  expect(
    (await value(h.api.invoke("reference_construction_get", {})))
      .geometryEncoding,
  ).toEqual(p.geometryEncoding);
  expect(h.commit).not.toHaveBeenCalled();
});

it("reinitializes an owned edit from the accepted object rather than quantizing a different unaccepted draft", async () => {
  const h = fixture();
  const changed = await value(
    h.command({
      action: "preview",
      kind: "point",
      entityId: "p",
      position: [9, 8, 7],
    }),
  );
  const p = await value(
    h.command({
      action: "preview",
      kind: "point",
      initialize: true,
      sessionId: changed.sessionId,
      version: changed.version,
    }),
  );
  expect(p.version).toBeGreaterThan(changed.version);
  expect(p.geometryEncoding).toEqual(pointEncoding([0, 0.007812, 1000.000244]));
  await cancel(h, p);
  expect(h.state.history).toHaveLength(0);
});

it("cancels prepared inputs without modifying accepted bits, saved identities or history", async () => {
  const h = fixture(),
    before = h.state.entities,
    original = encodeReferenceEntityData(find(h, "p").reference!),
    revision = h.api.currentRevision();
  const p = await initialize(h);
  await cancel(h, p);
  expect(h.state.entities).toBe(before);
  expect(encodeReferenceEntityData(find(h, "p").reference!)).toEqual(original);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.state.history).toHaveLength(0);
  expect(find(h, "p").constructionOrderKey).toBe("01".repeat(16));
});

it("keeps explicit typed create and explicit existing update values exact", async () => {
  const h = fixture();
  const typed: [number, number, number] = [0.00781254, -0, 1.2345678901234567];
  const create = await value(
    h.command({ action: "preview", kind: "point", position: typed }),
  );
  expect(create.geometryEncoding).toEqual(pointEncoding(typed));
  await cancel(h, create);
  const update = await value(
    h.command({
      action: "preview",
      kind: "point",
      entityId: "p",
      position: typed,
    }),
  );
  expect(update.geometryEncoding).toEqual(pointEncoding(typed));
  await apply(h, update);
  expect(encodeReferenceEntityData(find(h, "p").reference!).geometry).toEqual(
    pointEncoding(typed),
  );
});

it.each([
  { position: [1, 2, 3] },
  { positionPick: { entityId: "cloud", pointIndex: 0 } },
  { start: [0, 0, 0] },
  { end: [1, 0, 0] },
  { startPick: { entityId: "cloud", pointIndex: 0 } },
  { endPick: { entityId: "cloud", pointIndex: 0 } },
  { mode: "center", sourceEntityIds: ["p"] },
  { sourceEntityId: "l" },
  { sourcePicks: [{ entityId: "p" }] },
])(
  "rejects ambiguous initialization replacement %j before modifying the active preview",
  async (extra) => {
    const h = fixture(),
      owned = await value(
        h.command({
          action: "preview",
          kind: "point",
          entityId: "p",
          position: [9, 8, 7],
        }),
      );
    expect(
      await h.command({
        action: "preview",
        kind: "point",
        initialize: true,
        sessionId: owned.sessionId,
        version: owned.version,
        ...extra,
      }),
    ).toMatchObject({ ok: false });
    const current = await value(h.api.invoke("reference_construction_get", {}));
    expect(current.version).toBe(owned.version);
    expect(current.geometryEncoding).toEqual(owned.geometryEncoding);
    expect(h.commit).not.toHaveBeenCalled();
  },
);

it("rejects initialize on Apply/Cancel as a preview-only intent", async () => {
  const h = fixture(),
    p = await initialize(h);
  for (const action of ["apply", "cancel"])
    expect(
      await h.command({
        action,
        initialize: true,
        sessionId: p.sessionId,
        version: p.version,
      }),
    ).toMatchObject({ ok: false });
  expect(h.commit).not.toHaveBeenCalled();
  await cancel(h, p);
});

it("rejects initialize without an existing target and rejects a stale edit revision", async () => {
  const h = fixture();
  expect(
    await h.command({ action: "preview", kind: "point", initialize: true }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/existing|target|destination/i) },
  });
  const revision = h.api.currentRevision();
  h.state.entities = h.state.entities.map((row) =>
    row.id === "p" ? { ...row, name: "Renamed" } : row,
  );
  expect(
    await h.api.invoke("reference_construct", {
      action: "preview",
      kind: "point",
      entityId: "p",
      initialize: true,
      expectedRevision: revision,
      requestId: "stale-editor-read",
    }),
  ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  expect(h.commit).not.toHaveBeenCalled();
});

it("allows locked inspection but rejects initialization of a locked edit target", async () => {
  const h = fixture();
  find(h, "p").locked = true;
  expect(
    (await value(h.api.invoke("object_get", { entityId: "p" }))).reference
      .editorInputs.position[1],
  ).toBe(0.007812);
  expect(
    await h.command({
      action: "preview",
      kind: "point",
      entityId: "p",
      initialize: true,
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/locked/i) },
  });
  expect(h.commit).not.toHaveBeenCalled();
  expect(h.display).not.toHaveBeenCalled();
});

it("rejects initialization of derived recipes instead of silently detaching them", async () => {
  const h = fixture();
  const p = await value(
    h.command({
      action: "preview",
      kind: "point",
      mode: "center",
      sourceEntityIds: ["l"],
    }),
  );
  const made = await apply(h, p),
    before = h.state.entities;
  expect(
    await h.command({
      action: "preview",
      kind: "point",
      entityId: made.entityId,
      initialize: true,
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/numeric|derived|mode/i) },
  });
  expect(h.state.entities).toBe(before);
  expect(find(h, made.entityId).reference!.definition).toMatchObject({
    mode: "center",
    sources: [{ id: "l", constructionOrderKey: "02".repeat(16) }],
  });
  expect(h.state.history).toHaveLength(1);
});

it("rejects a line initializer whose prepared endpoints collapse without changing the accepted nonzero line", async () => {
  const source = line([1e-8, 0, 0], 1e-8),
    h = fixture([point(), source]),
    before = h.state.entities;
  const inspected = await value(h.api.invoke("object_get", { entityId: "l" }));
  expect(inspected.reference.editorInputs.start).toEqual(
    inspected.reference.editorInputs.end,
  );
  expect(
    await h.command({
      action: "preview",
      kind: "line",
      entityId: "l",
      initialize: true,
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/nonzero|degenerate|endpoint/i) },
  });
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toHaveLength(0);
  expect(h.display).not.toHaveBeenCalled();
});

it("does not replace another owned preview when beginning an initializer without its session identity", async () => {
  const h = fixture(),
    active = await value(
      h.command({ action: "preview", kind: "point", position: [9, 8, 7] }),
    );
  expect(
    await h.command({
      action: "preview",
      kind: "point",
      entityId: "p",
      initialize: true,
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/preview|active|owned|finish/i) },
  });
  const current = await value(h.api.invoke("reference_construction_get", {}));
  expect(current.sessionId).toBe(active.sessionId);
  expect(current.geometryEncoding).toEqual(active.geometryEncoding);
  expect(h.commit).not.toHaveBeenCalled();
});

it("retries Initialize/Apply exactly once and preserves prepared versus accepted states through history and codecs", async () => {
  const h = fixture(),
    original = h.state.entities;
  const request = {
    action: "preview",
    kind: "point",
    entityId: "p",
    initialize: true,
    expectedRevision: h.api.currentRevision(),
    requestId: "initialize-retry",
  };
  const p = await value(h.api.invoke("reference_construct", request));
  expect(await value(h.api.invoke("reference_construct", request))).toEqual(p);
  expect(h.state.history).toHaveLength(0);
  const applyRequest = {
    action: "apply",
    sessionId: p.sessionId,
    version: p.version,
    expectedRevision: h.api.currentRevision(),
    requestId: "initialize-apply-retry",
  };
  const result = await value(h.api.invoke("reference_construct", applyRequest));
  expect(
    await value(h.api.invoke("reference_construct", applyRequest)),
  ).toEqual(result);
  const converted = h.state.entities;
  expect(h.state.history).toHaveLength(1);
  expect(h.commit).toHaveBeenCalledOnce();
  await history(h, "undo");
  expect(h.state.entities).toBe(original);
  expect(h.state.future).toHaveLength(1);
  const project = {
    format: "maliev-scanforge" as const,
    version: 1 as const,
    units: "mm" as const,
    name: h.state.name,
    entities: h.state.entities,
    authoring: h.state.authoring,
  };
  const reopened = await decodeProjectContents(
    await encodeProjectFileLocally({
      project,
      history: h.state.history,
      future: h.state.future,
    }),
  );
  expect(
    encodeReferenceEntityData(reopened.project.entities[0].reference!),
  ).toEqual(encodeReferenceEntityData(original[0].reference!));
  expect(
    encodeReferenceEntityData(reopened.future[0].entities[0].reference!)
      .geometry,
  ).toEqual(p.geometryEncoding);
  for (const scene of [original, converted]) {
    const parsed = parseProject(serializeProject(h.state.name, scene));
    expect(encodeReferenceEntityData(parsed.entities[0].reference!)).toEqual(
      encodeReferenceEntityData(scene[0].reference!),
    );
    expect(scene[0].reference).not.toHaveProperty("editorInputs");
    expect(scene[0]).not.toHaveProperty("editorInputs");
  }
  await history(h, "redo");
  expect(h.state.entities).toBe(converted);
});

// These inspect/application fixtures do not claim an R11 QSF edit/apply receipt.
// Line signed-zero formatting, negative ties and other unit settings remain open.
