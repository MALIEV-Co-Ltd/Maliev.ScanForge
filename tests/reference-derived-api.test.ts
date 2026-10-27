import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import {
  createNumericDatumPlane,
  numericDatumFrame,
} from "../src/datum-construction";
import { lockedObjectEdit } from "../src/object-operations";
import {
  assertReferenceWorkspaceAdmission,
  encodeReferenceEntityData,
} from "../src/reference-entity";
import { encodeReferenceGeometry } from "../src/reference-construction-values";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
} from "../src/project-file-codec";
import { serializeProject, parseProject } from "../src/io";
import type { Entity, Vec3 } from "../src/types";
import * as registration from "../src/scan-registration";

// First public derived POINT slice: semantic sources + application numeric plane
// equations. No CAD/fit/scan acquisition or native retained-line-pick assertion.
const apis: ApplicationApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function point(id: string, position: Vec3, key: string): Entity {
  return {
    id,
    name: id,
    kind: "referencePoint",
    positions: [],
    color: "#ffffff",
    opacity: 1,
    visible: true,
    constructionOrderKey: key.repeat(16),
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
      evaluation: { completionWord: 0x100 },
    },
  };
}
function line(): Entity {
  return {
    id: "axis",
    name: "axis",
    kind: "referenceLine",
    positions: [],
    color: "#ffffff",
    opacity: 1,
    visible: true,
    constructionOrderKey: "03".repeat(16),
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "line",
        mode: "endpoints",
        start: [0, 0, 0],
        end: [10, 0, 0],
        sources: [],
        records: [],
      },
      geometry: {
        kind: "line",
        start: [0, 0, 0],
        direction: [1, 0, 0],
        length: 10,
      },
      evaluation: { completionWord: 0x100 },
    },
  };
}
function plane(id: string, origin: Vec3, normal: Vec3): Entity {
  return createNumericDatumPlane(numericDatumFrame(origin, normal), 10, id, id);
}
function fixtures(): Entity[] {
  return [
    point("a", [2, 4, 6], "01"),
    point("b", [10, 8, 12], "02"),
    line(),
    plane("px", [2, 0, 0], [1, 0, 0]),
    plane("py", [0, 4, 0], [0, 1, 0]),
    plane("pz", [0, 0, 6], [0, 0, 1]),
    {
      id: "scan",
      name: "scan",
      kind: "pointcloud",
      positions: new Float32Array([20, 30, 40]),
      color: "#ffffff",
      opacity: 1,
      visible: true,
    },
  ];
}
function setup(entities = fixtures()) {
  const state: WorkspaceSnapshot = {
    name: "Derived points",
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
      throw Error("Commit would edit locked geometry");
    state.history.push({ entities: state.entities, label });
    state.entities = next;
    state.future = [];
  });
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => {
      throw Error("No CAD in semantic fixture");
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
  return { state, api, host, display, commit, command };
}
async function value(
  promise: ReturnType<ApplicationApi["invoke"]>,
): Promise<any> {
  const reply = await promise;
  expect(reply.ok, JSON.stringify(reply)).toBe(true);
  if (!reply.ok) throw Error(reply.error.message);
  return reply.result;
}
async function preview(
  h: ReturnType<typeof setup>,
  mode: string,
  sourceEntityIds: string[],
  other: Record<string, unknown> = {},
) {
  return value(
    h.command({
      action: "preview",
      kind: "point",
      mode,
      sourceEntityIds,
      ...other,
    }),
  );
}
async function apply(h: ReturnType<typeof setup>, p: any) {
  return value(
    h.command({ action: "apply", sessionId: p.sessionId, version: p.version }),
  );
}
function entity(h: ReturnType<typeof setup>, id: string) {
  const e = h.state.entities.find((row) => row.id === id);
  expect(e).toBeDefined();
  return e!;
}
async function cancel(h: ReturnType<typeof setup>, p: any) {
  await value(
    h.command({ action: "cancel", sessionId: p.sessionId, version: p.version }),
  );
}
const sourceQuery = { kind: "point", mode: "pair", offset: 0, limit: 100 };

it("discovers only implemented point source modes and a read-only revision-stamped source query", async () => {
  const h = setup();
  const discovery = await value(
    h.api.invoke("tools_search", {
      query: "reference_construct",
      includeSchemas: true,
      limit: 20,
    }),
  );
  const construct = discovery.tools.find(
    (tool: any) => tool.name === "reference_construct",
  );
  expect(construct.inputSchema.properties.mode.enum).toEqual(
    expect.arrayContaining(["midpoint", "center", "pair", "threePlanes"]),
  );
  expect(construct.inputSchema.properties.sourceEntityIds.type).toBe("array");
  for (const forbidden of [
    "constructionOrderKey",
    "completionWord",
    "records",
    "provenance",
  ])
    expect(construct.inputSchema.properties[forbidden]).toBeUndefined();
  const queryTool = discovery.tools.find(
    (tool: any) => tool.name === "reference_construction_sources",
  );
  expect(queryTool).toMatchObject({ readOnly: true, job: false });
  const before = h.state.entities,
    revision = h.api.currentRevision();
  const reply = await h.api.invoke(
    "reference_construction_sources",
    sourceQuery,
  );
  expect(reply).toMatchObject({ ok: true, revision });
  if (!reply.ok) throw Error(reply.error.message);
  const result = reply.result as any;
  expect(result).toMatchObject({
    units: "mm",
    coordinateSpace: "world",
    total: 7,
    nextOffset: null,
  });
  expect(
    result.sources.find((row: any) => row.entityId === "axis"),
  ).toMatchObject({
    primitiveKind: "axis",
    eligible: true,
    constructionOrderKey: "03".repeat(16),
    identityStatus: "saved",
  });
  expect(
    result.sources.find((row: any) => row.entityId === "pz"),
  ).toMatchObject({
    primitiveKind: "plane",
    eligible: true,
    identityStatus: "provisional",
    constructionOrderKey: expect.stringMatching(/^[0-9a-f]{32}$/),
  });
  expect(
    result.sources.find((row: any) => row.entityId === "scan"),
  ).toMatchObject({
    eligible: false,
    reason: expect.stringMatching(/source|unsupported/i),
  });
  const first = await value(
    h.api.invoke("reference_construction_sources", {
      ...sourceQuery,
      limit: 2,
    }),
  );
  expect(first.sources).toHaveLength(2);
  expect(first.nextOffset).toBe(2);
  const rest = await value(
    h.api.invoke("reference_construction_sources", {
      ...sourceQuery,
      offset: 2,
    }),
  );
  expect([...first.sources, ...rest.sources]).toEqual(result.sources);
  expect(h.state.entities).toBe(before);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.commit).not.toHaveBeenCalled();
  expect(entity(h, "pz").constructionOrderKey).toBeUndefined();
  const midpointSources = await value(
    h.api.invoke("reference_construction_sources", {
      kind: "point",
      mode: "midpoint",
    }),
  );
  expect(
    midpointSources.sources
      .filter((row: any) => row.eligible)
      .map((row: any) => row.entityId),
  ).toEqual(["axis"]);
});

it("center preserves both admitted selectors although evaluation consumes only the first canonical source", async () => {
  const h = setup(),
    sourceA = entity(h, "a"),
    sourceAxis = entity(h, "axis");
  const p = await preview(h, "center", ["axis", "a"]);
  expect(p).toMatchObject({
    geometry: { kind: "point", position: [2, 4, 6] },
    outcome: "updated",
    diagnostics: { reason: "center", sourceCount: 2 },
  });
  expect(p.definition.sources.map((row: any) => row.id)).toEqual(["a", "axis"]);
  const result = await apply(h, p),
    created = entity(h, result.entityId);
  expect(created.reference!.definition.sources.map((row) => row.id)).toEqual([
    "a",
    "axis",
  ]);
  expect(created.reference!.geometry).toEqual(p.geometry);
  expect(entity(h, "a")).toBe(sourceA);
  expect(entity(h, "axis")).toBe(sourceAxis);
  expect(h.commit).toHaveBeenCalledOnce();
});

it("admits plane selectors for center and preserves the full common set with the recovered origin fallback", async () => {
  const sources = fixtures();
  sources.find((row) => row.id === "pz")!.constructionOrderKey = "00".repeat(
    16,
  );
  const h = setup(sources);
  const available = await value(
    h.api.invoke("reference_construction_sources", {
      kind: "point",
      mode: "center",
      limit: 100,
    }),
  );
  expect(
    available.sources.find((row: any) => row.entityId === "pz"),
  ).toMatchObject({ eligible: true, primitiveKind: "plane" });
  const p = await preview(h, "center", ["a", "pz"]);
  expect(p).toMatchObject({
    geometry: { kind: "point", position: [0, 0, 0] },
    outcome: "origin",
    diagnostics: { reason: "source-extraction-failed", sourceCount: 2 },
  });
  expect(p.definition.sources.map((row: any) => row.id)).toEqual(["pz", "a"]);
  const applied = await apply(h, p),
    accepted = entity(h, applied.entityId).reference!;
  expect(accepted.geometry).toEqual(p.geometry);
  expect(accepted.definition.sources.map((row) => row.id)).toEqual(["pz", "a"]);
  expect(h.commit).toHaveBeenCalledOnce();
});

it.each([
  ["center", ["axis"], [5, 0, 0]],
  ["pair", ["b", "a"], [6, 6, 9]],
  ["pair", ["a", "axis"], [2, 0, 0]],
  ["pair", ["b", "pz"], [10, 8, 6]],
  ["threePlanes", ["pz", "px", "py"], [2, 4, 6]],
] as const)(
  "publishes %s from independent authoritative source geometry: %j",
  async (mode, ids, expected) => {
    const h = setup(),
      prior = h.state.entities;
    const p = await preview(h, mode, [...ids]);
    expect(p.geometry).toEqual({ kind: "point", position: expected });
    expect(h.state.entities).toBe(prior);
    expect(h.commit).not.toHaveBeenCalled();
    const result = await apply(h, p);
    expect(entity(h, result.entityId).reference!.geometry).toEqual(p.geometry);
    expect(h.commit).toHaveBeenCalledOnce();
    expect(h.state.history).toHaveLength(1);
    const accepted = h.state.entities;
    await value(
      h.api.invoke("history_undo", {
        expectedRevision: h.api.currentRevision(),
        requestId: crypto.randomUUID(),
      }),
    );
    expect(h.state.entities).toBe(prior);
    await value(
      h.api.invoke("history_redo", {
        expectedRevision: h.api.currentRevision(),
        requestId: crypto.randomUUID(),
      }),
    );
    expect(h.state.entities).toBe(accepted);
  },
);

it("uses selected-source key-only migration for locked numeric planes, atomically with cached Apply", async () => {
  const sources = fixtures();
  sources.find((row) => row.id === "pz")!.locked = true;
  const h = setup(sources),
    locked = entity(h, "pz"),
    unselected = entity(h, "px"),
    positions = locked.positions;
  const p = await preview(h, "pair", ["b", "pz"]);
  expect(entity(h, "pz")).toBe(locked);
  expect(locked.constructionOrderKey).toBeUndefined();
  const result = await apply(h, p),
    migrated = entity(h, "pz");
  expect(result.assignedSources).toEqual([
    { id: "pz", constructionOrderKey: expect.stringMatching(/^[0-9a-f]{32}$/) },
  ]);
  expect(migrated.positions).toBe(positions);
  expect(migrated.locked).toBe(true);
  expect({ ...migrated, constructionOrderKey: undefined }).toEqual({
    ...locked,
    constructionOrderKey: undefined,
  });
  expect(entity(h, "px")).toBe(unselected);
  expect(unselected.constructionOrderKey).toBeUndefined();
  expect(h.commit.mock.calls[0][2]).toMatchObject({
    constructionIdentityMigration: result.assignedSources,
  });
});

it("cancels without migrating keys and retains exact session version/retry and stale-source rejection", async () => {
  const h = setup(),
    before = h.state.entities;
  const p = await preview(h, "threePlanes", ["px", "py", "pz"]);
  await cancel(h, p);
  expect(h.state.entities).toBe(before);
  expect(entity(h, "pz").constructionOrderKey).toBeUndefined();
  expect(h.commit).not.toHaveBeenCalled();
  const args = {
    action: "preview",
    kind: "point",
    mode: "pair",
    sourceEntityIds: ["a", "b"],
    expectedRevision: h.api.currentRevision(),
    requestId: "derived-preview",
  };
  const first = await value(h.api.invoke("reference_construct", args));
  expect(await value(h.api.invoke("reference_construct", args))).toEqual(first);
  const edited = await preview(h, "pair", ["a", "axis"], {
    sessionId: first.sessionId,
    version: first.version,
  });
  expect(edited.version).toBe(first.version + 1);
  expect(
    await h.command({
      action: "apply",
      sessionId: first.sessionId,
      version: first.version,
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/version/i) },
  });
  h.state.entities = h.state.entities.map((row) =>
    row.id === "a" ? { ...row, name: "changed source" } : row,
  );
  expect(
    await h.command({
      action: "apply",
      sessionId: edited.sessionId,
      version: edited.version,
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/stale|changed|session/i) },
  });
  expect(h.commit).not.toHaveBeenCalled();
});

it("retains prior point and dirty word1 for supported near-parallel axis/plane rejection on edit", async () => {
  const h = setup(),
    before = entity(h, "b").reference!.geometry;
  const p = await preview(h, "pair", ["axis", "pz"], { entityId: "b" });
  expect(p).toMatchObject({
    geometry: before,
    outcome: "unchanged",
    diagnostics: { reason: "axis-plane-nearly-parallel" },
  });
  await apply(h, p);
  expect(entity(h, "b").reference).toMatchObject({
    geometry: before,
    evaluation: { completionWord: 1 },
  });
  expect(entity(h, "b").reference!.definition.sources).toHaveLength(2);
});

it("refreshes source and derived child in one model edit and rejects locked-child edits atomically", async () => {
  const h = setup();
  const made = await apply(h, await preview(h, "pair", ["a", "b"]));
  const before = h.state.entities;
  const update = await value(
    h.command({
      action: "preview",
      kind: "point",
      entityId: "a",
      position: [4, 4, 6],
    }),
  );
  const result = await apply(h, update);
  expect(result.refreshedEntityIds).toContain(made.entityId);
  expect(entity(h, made.entityId).reference!.geometry).toEqual({
    kind: "point",
    position: [7, 6, 9],
  });
  expect(h.commit).toHaveBeenCalledTimes(2);
  await value(
    h.api.invoke("history_undo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "undo-source-edit",
    }),
  );
  expect(h.state.entities).toBe(before);
  h.state.entities = h.state.entities.map((row) =>
    row.id === made.entityId ? { ...row, locked: true } : row,
  );
  const locked = h.state.entities;
  const blocked = await value(
    h.command({
      action: "preview",
      kind: "point",
      entityId: "a",
      position: [8, 4, 6],
    }),
  );
  expect(
    await h.command({
      action: "apply",
      sessionId: blocked.sessionId,
      version: blocked.version,
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/locked/i) },
  });
  expect(h.state.entities).toBe(locked);
  expect(h.commit).toHaveBeenCalledTimes(2);
});

it("refreshes a numeric plane source and its point descendants in one reversible model edit", async () => {
  const h = setup();
  const parent = await apply(h, await preview(h, "pair", ["b", "pz"]));
  const child = await apply(h, await preview(h, "center", [parent.entityId]));
  const before = h.state.entities;
  const sourcePositions = entity(h, "pz").positions;
  const sourceBytes = Array.from(sourcePositions);
  await value(
    h.api.invoke("datum_construct", {
      kind: "plane",
      entityId: "pz",
      origin: [0, 0, 9],
      normal: [0, 0, 1],
      displaySize: 10,
      expectedRevision: h.api.currentRevision(),
      requestId: "edit-plane-source",
    }),
  );
  for (const id of [parent.entityId, child.entityId])
    expect(entity(h, id).reference!.geometry).toEqual({
      kind: "point",
      position: [10, 8, 9],
    });
  expect(Array.from(sourcePositions)).toEqual(sourceBytes);
  expect(h.commit).toHaveBeenCalledTimes(3);
  const after = h.state.entities;
  await value(
    h.api.invoke("history_undo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "undo-plane-source",
    }),
  );
  expect(h.state.entities).toBe(before);
  await value(
    h.api.invoke("history_redo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "redo-plane-source",
    }),
  );
  expect(h.state.entities).toBe(after);
});

it("rejects numeric plane source edits atomically when any point descendant is locked", async () => {
  const h = setup();
  const parent = await apply(h, await preview(h, "pair", ["b", "pz"]));
  const child = await apply(h, await preview(h, "center", [parent.entityId]));
  h.state.entities = h.state.entities.map((row) =>
    row.id === child.entityId ? { ...row, locked: true } : row,
  );
  const before = h.state.entities,
    revision = h.api.currentRevision();
  const reply = await h.api.invoke("datum_construct", {
    kind: "plane",
    entityId: "pz",
    origin: [0, 0, 9],
    normal: [0, 0, 1],
    displaySize: 10,
    expectedRevision: revision,
    requestId: "locked-plane-descendant",
  });
  expect(reply).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/locked/i) },
  });
  expect(h.state.entities).toBe(before);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.commit).toHaveBeenCalledTimes(2);
});

it("translates a numeric plane and refreshes its point chain in one exact-retry model edit", async () => {
  const h = setup();
  const parent = await apply(h, await preview(h, "pair", ["b", "pz"]));
  const child = await apply(h, await preview(h, "center", [parent.entityId]));
  const before = h.state.entities;
  const positions = entity(h, "pz").positions;
  const sourceBytes = Array.from(positions);
  const request = {
    entityId: "pz",
    translation: [0, 0, 3],
    rotation: [0, 0, 0],
    scale: 1,
    expectedRevision: h.api.currentRevision(),
    requestId: "translate-plane-source",
  };
  const result = await value(h.api.invoke("mesh_transform", request));
  expect(result.entityId).toBe("pz");
  expect(entity(h, "pz").kind).toBe("plane");
  expect(entity(h, "pz").planeFrame!.center).toEqual([0, 0, 9]);
  for (const id of [parent.entityId, child.entityId])
    expect(entity(h, id).reference!.geometry).toEqual({
      kind: "point",
      position: [10, 8, 9],
    });
  expect(Array.from(positions)).toEqual(sourceBytes);
  expect(h.commit).toHaveBeenCalledTimes(3);
  const after = h.state.entities;
  expect(await value(h.api.invoke("mesh_transform", request))).toEqual(result);
  expect(h.state.entities).toBe(after);
  expect(h.commit).toHaveBeenCalledTimes(3);
  await value(
    h.api.invoke("history_undo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "undo-translated-plane",
    }),
  );
  expect(h.state.entities).toBe(before);
  await value(
    h.api.invoke("history_redo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "redo-translated-plane",
    }),
  );
  expect(h.state.entities).toBe(after);
});

it.each(["direct child", "grandchild"])(
  "rejects plane translation with locked %s without changing root, descendants or history",
  async (lockedLevel) => {
    const h = setup();
    const parent = await apply(h, await preview(h, "pair", ["b", "pz"]));
    const child = await apply(h, await preview(h, "center", [parent.entityId]));
    const lockedId =
      lockedLevel === "direct child" ? parent.entityId : child.entityId;
    h.state.entities = h.state.entities.map((row) =>
      row.id === lockedId ? { ...row, locked: true } : row,
    );
    const before = h.state.entities,
      history = [...h.state.history],
      revision = h.api.currentRevision();
    expect(
      await h.api.invoke("mesh_transform", {
        entityId: "pz",
        translation: [0, 0, 3],
        rotation: [0, 0, 0],
        scale: 1,
        expectedRevision: revision,
        requestId: "locked-transform-dependent",
      }),
    ).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/locked/i) },
    });
    expect(h.state.entities).toBe(before);
    expect(h.state.history).toEqual(history);
    expect(h.api.currentRevision()).toBe(revision);
    expect(h.commit).toHaveBeenCalledTimes(2);
  },
);

it.each(["delete", "cut"] as const)(
  "rejects destructive selection_%s on a linked numeric plane without publishing geometry or selection",
  async (operation) => {
    const h = setup();
    await apply(h, await preview(h, "pair", ["b", "pz"]));
    h.state.selectedId = "pz";
    h.state.selection = new Uint8Array(
      operation === "delete" ? [1, 1] : [1, 0],
    );
    const before = h.state.entities,
      history = [...h.state.history],
      selection = h.state.selection,
      revision = h.api.currentRevision();
    const positions = entity(h, "pz").positions,
      bytes = Array.from(positions);
    expect(
      await h.api.invoke("selection_edit", {
        entityId: "pz",
        operation,
        expectedRevision: revision,
        requestId: `linked-plane-${operation}`,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        message: expect.stringMatching(/reference|source|construction|plane/i),
      },
    });
    expect(h.state.entities).toBe(before);
    expect(h.state.history).toEqual(history);
    expect(h.state.selection).toBe(selection);
    expect(Array.from(positions)).toEqual(bytes);
    expect(h.api.currentRevision()).toBe(revision);
    expect(h.host.setSelection).not.toHaveBeenCalled();
    expect(h.commit).toHaveBeenCalledOnce();
  },
);

it("rejects replacing a linked plane with a NURBS mesh before publishing history", async () => {
  const h = setup();
  await apply(h, await preview(h, "pair", ["b", "pz"]));
  h.state.selectedId = "pz";
  h.state.selection = new Uint8Array([1, 0]);
  const before = h.state.entities,
    history = [...h.state.history],
    selection = h.state.selection,
    revision = h.api.currentRevision();
  const patch = {
    format: "scanforge-nurbs",
    version: 1,
    countU: 2,
    countV: 2,
    degreeU: 1,
    degreeV: 1,
    knotsU: [0, 0, 1, 1],
    knotsV: [0, 0, 1, 1],
    points: [
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
      [10, 10, 0],
    ],
    weights: [1, 1, 1, 1],
  };
  expect(
    await h.api.invoke("surface_set", {
      entityId: "pz",
      patch,
      expectedRevision: revision,
      requestId: "replace-linked-plane-surface",
    }),
  ).toMatchObject({
    ok: false,
    error: {
      message: expect.stringMatching(/reference|source|construction|plane/i),
    },
  });
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toEqual(history);
  expect(h.state.selection).toBe(selection);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.host.setSelection).not.toHaveBeenCalled();
  expect(h.commit).toHaveBeenCalledOnce();
});

it("rejects a mocked worker mesh edit that would strip a linked plane frame before publishing selection", async () => {
  const h = setup();
  await apply(h, await preview(h, "pair", ["b", "pz"]));
  h.state.selectedId = "pz";
  h.state.selection = new Uint8Array([1, 1]);
  const before = h.state.entities,
    history = [...h.state.history],
    selection = h.state.selection,
    revision = h.api.currentRevision();
  const source = entity(h, "pz"),
    bytes = Array.from(source.positions);
  const process = vi
    .spyOn(registration, "processScanRegistration")
    .mockResolvedValue({
      kind: "smooth",
      positions: Float32Array.from(source.positions, (value) => value + 1),
      selection: new Uint8Array([1, 0]),
      diagnostics: { mockedWorkerBoundary: true },
    });
  const receipt = await value(
    h.api.invoke("mesh_process", {
      entityId: "pz",
      operation: {
        kind: "smooth",
        tolerance: 0.01,
        iterations: 1,
        strength: 0.5,
      },
      expectedRevision: revision,
      requestId: "worker-retypes-linked-plane",
    }),
  );
  let job: any;
  for (let attempt = 0; attempt < 100; attempt++) {
    job = await value(h.api.invoke("job_get", { jobId: receipt.jobId }));
    if (job.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  expect(process).toHaveBeenCalledOnce();
  expect(job).toMatchObject({
    status: "failed",
    error: {
      message: expect.stringMatching(/reference|source|construction|plane/i),
    },
  });
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toEqual(history);
  expect(h.state.selection).toBe(selection);
  expect(Array.from(source.positions)).toEqual(bytes);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.host.setSelection).not.toHaveBeenCalled();
  expect(h.commit).toHaveBeenCalledOnce();
});

it("allows an independent mesh copy while preserving the linked numeric plane and its point", async () => {
  const h = setup();
  const made = await apply(h, await preview(h, "pair", ["b", "pz"]));
  const source = entity(h, "pz"),
    child = entity(h, made.entityId);
  const copy = await value(
    h.api.invoke("mesh_copy", {
      entityId: "pz",
      expectedRevision: h.api.currentRevision(),
      requestId: "copy-linked-plane-display",
    }),
  );
  expect(entity(h, "pz")).toBe(source);
  expect(entity(h, made.entityId)).toBe(child);
  expect(entity(h, copy.entityId).kind).toBe("mesh");
  expect(Array.from(entity(h, copy.entityId).positions)).toEqual(
    Array.from(source.positions),
  );
  expect(entity(h, copy.entityId).positions).not.toBe(source.positions);
  expect(h.commit).toHaveBeenCalledTimes(2);
});

it("preserves accepted bindings and geometry in JSON/binary current, Undo and Redo states", async () => {
  const sources = fixtures();
  sources[0] = point("a", [2, -0, 6], "01");
  const h = setup(sources);
  await apply(h, await preview(h, "threePlanes", ["px", "py", "pz"]));
  await value(
    h.api.invoke("history_undo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "history-to-future",
    }),
  );
  const project = {
    format: "maliev-scanforge" as const,
    version: 1 as const,
    name: h.state.name,
    units: "mm" as const,
    entities: h.state.entities,
  };
  const session = { project, history: h.state.history, future: h.state.future };
  const reopened = await decodeProjectContents(
    await encodeProjectFileLocally(session),
  );
  // Other entity families retain their established decoder normalization. Compare
  // only this slice's authoritative semantic payloads, keys and plane frames.
  const semanticState = (entities: Entity[]) =>
    entities
      .filter(
        (row) => row.reference !== undefined || row.planeFrame !== undefined,
      )
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        constructionOrderKey: row.constructionOrderKey,
        reference: row.reference && encodeReferenceEntityData(row.reference),
        planeFrame:
          row.planeFrame &&
          Object.fromEntries(
            Object.entries(row.planeFrame).map(([key, position]) => [
              key,
              typeof position === "number"
                ? position
                : encodeReferenceGeometry({ kind: "point", position }).bits,
            ]),
          ),
      }));
  const timeline = (rows: typeof session.future) =>
    rows.map((row) => ({
      label: row.label,
      entities: semanticState(row.entities),
    }));
  expect(() => assertReferenceWorkspaceAdmission(reopened)).not.toThrow();
  expect(semanticState(reopened.project.entities)).toEqual(
    semanticState(session.project.entities),
  );
  expect(timeline(reopened.history)).toEqual(timeline(session.history));
  expect(timeline(reopened.future)).toEqual(timeline(session.future));
  const accepted = session.future[0].entities;
  expect(
    semanticState(parseProject(serializeProject("Derived", accepted)).entities),
  ).toEqual(semanticState(accepted));
  const broken = structuredClone(reopened);
  const derived = broken.future[0].entities.find(
    (row) =>
      row.kind === "referencePoint" &&
      row.reference!.definition.sources.length === 3,
  )!;
  derived.reference!.definition = {
    ...derived.reference!.definition,
    sources: derived.reference!.definition.sources.map((source, index) =>
      index === 0
        ? { ...source, constructionOrderKey: "ff".repeat(16) }
        : source,
    ),
  };
  expect(() => assertReferenceWorkspaceAdmission(broken)).toThrow(
    /identity|source|binding|unsupported/i,
  );
});

it.each([
  { mode: "center", sourceEntityIds: "a" },
  { mode: "pair", sourceEntityIds: [null] },
  { mode: "threePlanes", sourceEntityIds: {} },
  { mode: "pair", sourceEntityIds: ["a", "scan"] },
  { mode: "pair", sourceEntityIds: ["a", "missing"] },
  { mode: "center", sourceEntityIds: ["a"], position: [0, 0, 0] },
  {
    mode: "pair",
    sourceEntityIds: ["a", "b"],
    constructionOrderKey: "ff".repeat(16),
  },
  { mode: "pair", sourceEntityIds: ["a", "b"], completionWord: 256 },
  {
    mode: "pair",
    sourceEntityIds: ["a", "b"],
    records: [{ entityId: "a", coordinates: [0, 0, 0] }],
  },
])(
  "rejects ambiguous, injected or ineligible source intent without mutation: %j",
  async (args) => {
    const h = setup(),
      before = h.state.entities,
      revision = h.api.currentRevision();
    const reply = await h.command({
      action: "preview",
      kind: "point",
      ...args,
    });
    expect(reply).toMatchObject({ ok: false });
    if (!reply.ok)
      expect(["INVALID_ARGUMENT", "OPERATION_FAILED"]).toContain(
        reply.error.code,
      );
    expect(h.state.entities).toBe(before);
    expect(h.api.currentRevision()).toBe(revision);
    expect(h.commit).not.toHaveBeenCalled();
  },
);

it("rejects self-dependency and family cycles while preserving an owned editable preview", async () => {
  const h = setup();
  expect(
    await h.command({
      action: "preview",
      kind: "point",
      mode: "center",
      sourceEntityIds: ["a"],
      entityId: "a",
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/itself|cycle|self/i) },
  });
  const made = await apply(h, await preview(h, "center", ["a"]));
  const before = h.state.entities;
  const reply = await h.command({
    action: "preview",
    kind: "point",
    mode: "center",
    sourceEntityIds: [made.entityId],
    entityId: "a",
  });
  // Detect at preview admission or at Apply; never publish a cycle.
  if (reply.ok) {
    const p = reply.result as any;
    expect(
      await h.command({
        action: "apply",
        sessionId: p.sessionId,
        version: p.version,
      }),
    ).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/cycle/i) },
    });
    expect(
      await value(h.api.invoke("reference_construction_get", {})),
    ).toMatchObject({ active: true, sessionId: p.sessionId });
  } else expect(reply.error.message).toMatch(/cycle/i);
  expect(h.state.entities).toBe(before);
  expect(h.commit).toHaveBeenCalledOnce();
});
