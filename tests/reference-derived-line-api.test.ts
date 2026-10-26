// Shared GUI/MCP line-mode contract; first RED receipt precedes implementation.
import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { lockedObjectEdit } from "../src/object-operations";
import { encodeReferenceEntityData } from "../src/reference-entity";
import {
  referenceLineEnd,
  type ReferenceLineGeometry,
} from "../src/reference-construction-values";
import { serializeProject, parseProject } from "../src/io";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
} from "../src/project-file-codec";
import type { Entity, Vec3 } from "../src/types";

type LocatedSource = { entityId: string; parameter?: number };
const apis: ApplicationApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function point(id: string, position: Vec3, byte: string): Entity {
  return {
    id,
    name: id,
    kind: "referencePoint",
    positions: [],
    color: "#ffffff",
    opacity: 1,
    visible: true,
    constructionOrderKey: byte.repeat(16),
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
function axis(id: string, y: number, byte: string): Entity {
  return {
    ...point(id, [0, y, 0], byte),
    kind: "referenceLine",
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "line",
        mode: "endpoints",
        start: [0, y, 0],
        end: [10, y, 0],
        sources: [],
        records: [],
      },
      geometry: {
        kind: "line",
        start: [0, y, 0],
        direction: [1, 0, 0],
        length: 10,
      },
      evaluation: { completionWord: 256 },
    },
  };
}
function fixture() {
  const state: WorkspaceSnapshot = {
    name: "Located semantic line proposal",
    entities: [
      point("a", [1.0000005, 2, -0], "02"),
      point("b", [9.0000005, 2, 0], "01"),
      axis("x1", 2, "03"),
      axis("x2", 6, "04"),
      {
        id: "scan",
        name: "scan",
        kind: "pointcloud",
        positions: new Float32Array([0, 0, 0]),
        color: "#ffffff",
        opacity: 1,
        visible: true,
      },
    ],
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: null,
    selection: null,
  };
  const commit = vi.fn<WorkspaceHost["commit"]>((next, label, policy) => {
    if (lockedObjectEdit(state.entities, next, policy))
      throw Error("Locked geometry edit");
    state.history.push({ entities: state.entities, label });
    state.entities = next;
    state.future = [];
  });
  const display = vi.fn();
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => {
      throw Error("No CAD in semantic proposal");
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
  return { state, host, api, commit, command, display };
}
type Fixture = ReturnType<typeof fixture>;
async function value(
  promise: ReturnType<ApplicationApi["invoke"]>,
): Promise<any> {
  const reply = await promise;
  expect(reply.ok, JSON.stringify(reply)).toBe(true);
  if (!reply.ok) throw Error(reply.error.message);
  return reply.result;
}
const find = (h: Fixture, id: string) =>
  h.state.entities.find((row) => row.id === id)!;
const lineGeometry = (h: Fixture, id: string) =>
  find(h, id).reference!.geometry as ReferenceLineGeometry;
async function seed(h: Fixture) {
  return value(
    h.command({
      action: "preview",
      kind: "line",
      start: [0, 0, 0],
      end: [10, 0, 0],
    }),
  );
}
async function located(
  h: Fixture,
  prior: any,
  mode: "pair" | "average",
  sourcePicks: LocatedSource[],
) {
  return value(
    h.command({
      action: "preview",
      kind: "line",
      mode,
      sourcePicks,
      sessionId: prior.sessionId,
      version: prior.version,
    }),
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

it("discovers a located semantic source intent without accepting caller-authored records or identities", async () => {
  const h = fixture();
  const discovery = await value(
    h.api.invoke("tools_search", {
      query: "reference_construct",
      includeSchemas: true,
      limit: 20,
    }),
  );
  const schema = discovery.tools.find(
    (row: any) => row.name === "reference_construct",
  ).inputSchema;
  expect(schema.properties.sourcePicks).toMatchObject({
    type: "array",
    items: { additionalProperties: false },
  });
  expect(
    Object.keys(schema.properties.sourcePicks.items.properties).sort(),
  ).toEqual(["entityId", "parameter", "planeUV"]);
  for (const field of [
    "records",
    "constructionOrderKey",
    "completionWord",
    "provenance",
    "pickBits",
  ])
    expect(schema.properties[field]).toBeUndefined();
});

it("queries line pair and average eligibility read-only through the same paged source route", async () => {
  const h = fixture(),
    before = h.state.entities,
    revision = h.api.currentRevision();
  const pair = await value(
    h.api.invoke("reference_construction_sources", {
      kind: "line",
      mode: "pair",
      offset: 0,
      limit: 100,
    }),
  );
  expect(pair.sources.find((row: any) => row.entityId === "a")).toMatchObject({
    eligible: true,
    primitiveKind: "point",
  });
  expect(pair.sources.find((row: any) => row.entityId === "x1")).toMatchObject({
    eligible: true,
    primitiveKind: "axis",
  });
  expect(
    pair.sources.find((row: any) => row.entityId === "scan"),
  ).toMatchObject({ eligible: false });
  const average = await value(
    h.api.invoke("reference_construction_sources", {
      kind: "line",
      mode: "average",
      offset: 0,
      limit: 2,
    }),
  );
  expect(average.nextOffset).toBe(2);
  expect(average.sources.every((row: any) => row.eligible === false)).toBe(
    true,
  );
  const page2 = await value(
    h.api.invoke("reference_construction_sources", {
      kind: "line",
      mode: "average",
      offset: average.nextOffset,
      limit: 2,
    }),
  );
  expect(page2.sources.map((row: any) => [row.entityId, row.eligible])).toEqual(
    [
      ["x1", true],
      ["x2", true],
    ],
  );
  expect(h.state.entities).toBe(before);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.state.history).toHaveLength(0);
});

it("preserves requested record order separately from canonical common-source order and avoids numeric N6 baking", async () => {
  const h = fixture();
  const p = await located(h, await seed(h), "pair", [
    { entityId: "a" },
    { entityId: "b" },
  ]);
  expect(p.definition.sources.map((row: any) => row.id)).toEqual(["b", "a"]);
  expect(p.definition.records.map((row: any) => row.entityId)).toEqual([
    "a",
    "b",
  ]);
  expect(p.definition.records[0]).toEqual({
    entityId: "a",
    storage: "native-pick-record-f32",
    coordinates: [1.0000004768371582, 2, -0],
  });
  expect(p.definitionEncoding.records[0].bits).toBe("0400803f0000004000000080");
  expect(p.definition.records[0].coordinates[0]).not.toBe(1.0000009536743164);
  expect(p.geometry.start).toEqual([1.0000005, 2, -0]);
  expect(p.geometry.direction).toEqual([1, 0, 0]);
  expect(p.geometry.length).toBeCloseTo(8, 13);
  expect(h.commit).not.toHaveBeenCalled();
  const result = await apply(h, p);
  expect(find(h, result.entityId).reference!.definition).toEqual(p.definition);
  expect(
    encodeReferenceEntityData(find(h, result.entityId).reference!),
  ).toEqual(
    encodeReferenceEntityData({
      version: 1,
      definition: p.definition,
      geometry: p.geometry,
      evaluation: { completionWord: 256 },
    }),
  );
  expect(h.state.history).toHaveLength(1);
});

it("derives a line hit from authoritative stored extent, consumes the fraction once, and retains F32 world hit only", async () => {
  const h = fixture();
  const source = find(h, "x1");
  source.reference!.geometry = {
    kind: "line",
    start: [1, 2, 3],
    direction: [2, 0, 0],
    length: 5,
  };
  const p = await located(h, await seed(h), "pair", [
    { entityId: "a" },
    { entityId: "x1", parameter: 0.75 },
  ]);
  expect(p.definition.records[1]).toEqual({
    entityId: "x1",
    storage: "native-pick-record-f32",
    coordinates: [8.5, 2, 3],
  });
  expect(p.definition.records[1]).not.toHaveProperty("parameter");
  expect(source.reference!.geometry).toEqual({
    kind: "line",
    start: [1, 2, 3],
    direction: [2, 0, 0],
    length: 5,
  });
});

it("evaluates average from an explicit owned prior and preserves repeated weighting and independent hit suffixes", async () => {
  const h = fixture();
  const p = await located(h, await seed(h), "average", [
    { entityId: "x1", parameter: 0.25 },
    { entityId: "x2", parameter: 0.75 },
    { entityId: "x1", parameter: 0.5 },
  ]);
  expect(p.definition.sources.map((row: any) => row.id)).toEqual(["x1", "x2"]);
  expect(p.definition.records.map((row: any) => row.coordinates)).toEqual([
    [2.5, 2, 0],
    [7.5, 6, 0],
    [5, 2, 0],
  ]);
  expect(p.geometry.start[0]).toBe(0);
  expect(p.geometry.start[1]).toBeCloseTo(10 / 3, 13);
  expect(referenceLineEnd(p.geometry)[0]).toBe(10);
  expect(p.geometry.length).toBe(10);
  expect(p.diagnostics.reason).toBe("average-prior-extent");
  const result = await apply(h, p);
  expect(
    (find(h, result.entityId).reference!.definition as any).records,
  ).toHaveLength(3);
});

it("does not invent a constructor prior for a new directly requested derived line", async () => {
  const h = fixture(),
    before = h.state.entities;
  const reply = await h.command({
    action: "preview",
    kind: "line",
    mode: "average",
    sourcePicks: [
      { entityId: "x1", parameter: 0.5 },
      { entityId: "x2", parameter: 0.5 },
    ],
  });
  expect(reply).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/prior|owned|seed|existing/i) },
  });
  expect(h.state.entities).toBe(before);
  expect(h.commit).not.toHaveBeenCalled();
});

it.each([
  [{ entityId: "x1" }, { entityId: "b" }],
  [{ entityId: "x1", parameter: -0.1 }, { entityId: "b" }],
  [{ entityId: "x1", parameter: 1.1 }, { entityId: "b" }],
  [{ entityId: "a", parameter: 0.5 }, { entityId: "b" }],
  [{ entityId: "missing" }, { entityId: "b" }],
  [{ entityId: "scan", parameter: 0.5 }, { entityId: "b" }],
  [{ entityId: "a", coordinates: [0, 0, 0] }, { entityId: "b" }],
  [{ entityId: "a", constructionOrderKey: "00".repeat(16) }, { entityId: "b" }],
] as unknown as LocatedSource[][])(
  "rejects malformed/unmapped located source intent %j without replacing the owned preview",
  async (picks) => {
    const h = fixture(),
      prior = await seed(h),
      revision = h.api.currentRevision();
    expect(
      await h.command({
        action: "preview",
        kind: "line",
        mode: "pair",
        sourcePicks: picks,
        sessionId: prior.sessionId,
        version: prior.version,
      }),
    ).toMatchObject({ ok: false });
    const retained = await value(
      h.api.invoke("reference_construction_get", {}),
    );
    expect(retained.version).toBe(prior.version);
    expect(retained.geometryEncoding).toEqual(prior.geometryEncoding);
    expect(h.api.currentRevision()).toBe(revision);
    expect(h.commit).not.toHaveBeenCalled();
  },
);

it("does not let sourcePicks bypass Preview on Apply or Cancel", async () => {
  const h = fixture(),
    p = await located(h, await seed(h), "pair", [
      { entityId: "a" },
      { entityId: "b" },
    ]);
  for (const action of ["apply", "cancel"])
    expect(
      await h.command({
        action,
        sessionId: p.sessionId,
        version: p.version,
        sourcePicks: [{ entityId: "a" }, { entityId: "b" }],
      }),
    ).toMatchObject({ ok: false });
  expect(h.commit).not.toHaveBeenCalled();
  await cancel(h, p);
});

it("applies exact cached geometry once and returns the same retry receipt without a second history entry", async () => {
  const h = fixture(),
    p = await located(h, await seed(h), "pair", [
      { entityId: "a" },
      { entityId: "b" },
    ]);
  const request = {
    action: "apply",
    sessionId: p.sessionId,
    version: p.version,
    expectedRevision: h.api.currentRevision(),
    requestId: "located-apply-retry",
  };
  const first = await value(h.api.invoke("reference_construct", request));
  const again = await value(h.api.invoke("reference_construct", request));
  expect(again).toEqual(first);
  expect(h.state.history).toHaveLength(1);
  expect(find(h, first.entityId).reference!.geometry).toEqual(p.geometry);
});

it("cancels without changing saved identities, history, or sources", async () => {
  const h = fixture();
  const before = h.state.entities,
    key = find(h, "a").constructionOrderKey,
    revision = h.api.currentRevision();
  const p = await located(h, await seed(h), "pair", [
    { entityId: "a" },
    { entityId: "b" },
  ]);
  await cancel(h, p);
  expect(h.state.entities).toBe(before);
  expect(find(h, "a").constructionOrderKey).toBe(key);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.state.history).toHaveLength(0);
});

it("rejects Apply after source changes instead of quietly reacquiring a different hit", async () => {
  const h = fixture(),
    p = await located(h, await seed(h), "pair", [
      { entityId: "a" },
      { entityId: "b" },
    ]);
  h.state.entities = h.state.entities.map((row) =>
    row.id === "b" ? point("b", [20, 2, 0], "01") : row,
  );
  const before = h.state.entities;
  expect(
    await h.command({
      action: "apply",
      sessionId: p.sessionId,
      version: p.version,
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/stale|changed|session/i) },
  });
  expect(h.state.entities).toBe(before);
  expect(h.commit).not.toHaveBeenCalled();
});

it("refreshes live line/point descendants atomically while keeping historical retained hits unchanged", async () => {
  const h = fixture(),
    made = await apply(
      h,
      await located(h, await seed(h), "pair", [
        { entityId: "a" },
        { entityId: "b" },
      ]),
    );
  const center = await value(
    h.command({
      action: "preview",
      kind: "point",
      mode: "center",
      sourceEntityIds: [made.entityId],
    }),
  );
  const child = await apply(h, center),
    before = h.state.entities;
  const retained = encodeReferenceEntityData(find(h, made.entityId).reference!);
  const changed = await value(
    h.command({
      action: "preview",
      kind: "point",
      entityId: "a",
      position: [3.0000005, 2, 0],
    }),
  );
  const result = await apply(h, changed);
  expect(result.refreshedEntityIds).toEqual(
    expect.arrayContaining([made.entityId, child.entityId]),
  );
  expect(lineGeometry(h, made.entityId).start[0]).toBe(3.0000005);
  const midpoint = find(h, child.entityId).reference!.geometry;
  expect(midpoint.kind).toBe("point");
  if (midpoint.kind !== "point") throw Error("Expected child point");
  expect(midpoint.position[0]).toBeCloseTo(6.0000005, 13);
  expect(midpoint.position.slice(1)).toEqual([2, 0]);
  expect(
    encodeReferenceEntityData(find(h, made.entityId).reference!).definition,
  ).toEqual(retained.definition);
  const after = h.state.entities;
  expect(h.state.history).toHaveLength(3);
  await history(h, "undo");
  expect(h.state.entities).toBe(before);
  await history(h, "redo");
  expect(h.state.entities).toBe(after);
});

it("rejects source edits with locked line descendants before publishing root/history changes", async () => {
  const h = fixture(),
    made = await apply(
      h,
      await located(h, await seed(h), "pair", [
        { entityId: "a" },
        { entityId: "b" },
      ]),
    );
  h.state.entities = h.state.entities.map((row) =>
    row.id === made.entityId ? { ...row, locked: true } : row,
  );
  const before = h.state.entities,
    revision = h.api.currentRevision();
  const p = await value(
    h.command({
      action: "preview",
      kind: "point",
      entityId: "a",
      position: [3, 2, 0],
    }),
  );
  expect(
    await h.command({
      action: "apply",
      sessionId: p.sessionId,
      version: p.version,
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/locked/i) },
  });
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toHaveLength(1);
  expect(h.api.currentRevision()).toBe(revision);
});

it("rejects editing a locked target without modifying its accepted line or creating a preview", async () => {
  const h = fixture(),
    made = await apply(
      h,
      await located(h, await seed(h), "pair", [
        { entityId: "a" },
        { entityId: "b" },
      ]),
    );
  h.state.entities = h.state.entities.map((row) =>
    row.id === made.entityId ? { ...row, locked: true } : row,
  );
  const before = h.state.entities;
  expect(
    await h.command({
      action: "preview",
      kind: "line",
      mode: "pair",
      entityId: made.entityId,
      sourcePicks: [{ entityId: "b" }, { entityId: "a" }],
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/locked/i) },
  });
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toHaveLength(1);
  expect(
    await value(h.api.invoke("reference_construction_get", {})),
  ).toMatchObject({ active: false });
});

it("reads a locked semantic source without changing its saved identity or geometry", async () => {
  const h = fixture();
  const a = find(h, "a");
  a.locked = true;
  const original = a.reference,
    key = a.constructionOrderKey;
  const p = await located(h, await seed(h), "pair", [
    { entityId: "a" },
    { entityId: "b" },
  ]);
  expect(find(h, "a")).toBe(a);
  expect(a.constructionOrderKey).toBe(key);
  const result = await apply(h, p);
  expect(result.assignedSources).toEqual([]);
  expect(find(h, "a").locked).toBe(true);
  expect(find(h, "a").reference).toBe(original);
  expect(find(h, "a").constructionOrderKey).toBe(key);
  expect(h.state.history).toHaveLength(1);
  await history(h, "undo");
  expect(find(h, "a")).toBe(a);
  expect(a.constructionOrderKey).toBe(key);
});

it("rejects a keyless semantic source instead of treating an invalid reference as a legacy datum", async () => {
  const h = fixture(),
    source = find(h, "a");
  delete source.constructionOrderKey;
  source.locked = true;
  const before = h.state.entities,
    revision = h.api.currentRevision();
  expect(
    await h.command({
      action: "preview",
      kind: "line",
      entityId: "x1",
      mode: "pair",
      sourcePicks: [{ entityId: "a" }, { entityId: "b" }],
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/construction order key/i) },
  });
  expect(h.state.entities).toBe(before);
  expect(source.constructionOrderKey).toBeUndefined();
  expect(h.state.history).toHaveLength(0);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.display).not.toHaveBeenCalled();
});

it("rejects deleting a live source alone and deletes the selected dependency closure in one reversible history step", async () => {
  const h = fixture(),
    made = await apply(
      h,
      await located(h, await seed(h), "pair", [
        { entityId: "a" },
        { entityId: "b" },
      ]),
    );
  const before = h.state.entities;
  expect(
    await h.api.invoke("object_delete", {
      entityIds: ["a"],
      expectedRevision: h.api.currentRevision(),
      requestId: "delete-source-only",
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/depend|reference/i) },
  });
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toHaveLength(1);
  await value(
    h.api.invoke("object_delete", {
      entityIds: ["a", made.entityId],
      expectedRevision: h.api.currentRevision(),
      requestId: "delete-reference-closure",
    }),
  );
  expect(
    h.state.entities.some((row) => row.id === "a" || row.id === made.entityId),
  ).toBe(false);
  expect(h.state.history).toHaveLength(2);
  const after = h.state.entities;
  await history(h, "undo");
  expect(h.state.entities).toBe(before);
  await history(h, "redo");
  expect(h.state.entities).toBe(after);
});

it("retains inactive records when switching a derived line back to endpoints and stops following old common sources", async () => {
  const h = fixture(),
    made = await apply(
      h,
      await located(h, await seed(h), "pair", [
        { entityId: "a" },
        { entityId: "b" },
      ]),
    );
  const records = (find(h, made.entityId).reference!.definition as any).records;
  const detached = await value(
    h.command({
      action: "preview",
      kind: "line",
      entityId: made.entityId,
      start: [20, 0, 0],
      end: [30, 0, 0],
    }),
  );
  await apply(h, detached);
  expect(find(h, made.entityId).reference!.definition).toMatchObject({
    mode: "endpoints",
    sources: [],
    records,
  });
  const geometry = lineGeometry(h, made.entityId);
  const sourceEdit = await value(
    h.command({
      action: "preview",
      kind: "point",
      entityId: "a",
      position: [4, 2, 0],
    }),
  );
  await apply(h, sourceEdit);
  expect(lineGeometry(h, made.entityId)).toEqual(geometry);
  expect((find(h, made.entityId).reference!.definition as any).records).toEqual(
    records,
  );
});

it("excludes target and descendants from query and rejects a cycle at preview without replacing accepted geometry", async () => {
  const h = fixture(),
    made = await apply(
      h,
      await located(h, await seed(h), "pair", [
        { entityId: "a" },
        { entityId: "b" },
      ]),
    );
  const center = await value(
    h.command({
      action: "preview",
      kind: "point",
      mode: "center",
      sourceEntityIds: [made.entityId],
    }),
  );
  const child = await apply(h, center),
    before = h.state.entities;
  const q = await value(
    h.api.invoke("reference_construction_sources", {
      kind: "line",
      mode: "pair",
      entityId: made.entityId,
      limit: 100,
    }),
  );
  for (const id of [made.entityId, child.entityId])
    expect(q.sources.find((row: any) => row.entityId === id)).toMatchObject({
      eligible: false,
      reason: expect.stringMatching(/cycle/i),
    });
  expect(
    await h.command({
      action: "preview",
      kind: "line",
      entityId: made.entityId,
      mode: "pair",
      sourcePicks: [{ entityId: child.entityId }, { entityId: "b" }],
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/cycle/i) },
  });
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toHaveLength(2);
});

it("preserves exact geometry, ordered F32 records, common keys and both history directions through JSON and binary reopen", async () => {
  const h = fixture(),
    made = await apply(
      h,
      await located(h, await seed(h), "pair", [
        { entityId: "a" },
        { entityId: "b" },
      ]),
    );
  const p = await value(
    h.command({
      action: "preview",
      kind: "point",
      entityId: "a",
      position: [3.0000005, 2, 0],
    }),
  );
  await apply(h, p);
  await history(h, "undo");
  const expected = [
    h.state.entities,
    ...h.state.history.map((row) => row.entities),
    ...h.state.future.map((row) => row.entities),
  ].map((scene) =>
    scene
      .filter((row) => row.reference)
      .map((row) => ({
        id: row.id,
        key: row.constructionOrderKey,
        reference: encodeReferenceEntityData(row.reference!),
      })),
  );
  const project = {
    format: "maliev-scanforge" as const,
    version: 1 as const,
    units: "mm" as const,
    name: h.state.name,
    entities: h.state.entities,
    authoring: h.state.authoring,
  };
  const session = { project, history: h.state.history, future: h.state.future };
  const binary = await decodeProjectContents(
    await encodeProjectFileLocally(session),
  );
  const reopenedScenes = [
    binary.project.entities,
    ...binary.history.map((row) => row.entities),
    ...binary.future.map((row) => row.entities),
  ];
  const actual = reopenedScenes.map((scene) =>
    scene
      .filter((row) => row.reference)
      .map((row) => ({
        id: row.id,
        key: row.constructionOrderKey,
        reference: encodeReferenceEntityData(row.reference!),
      })),
  );
  expect(actual).toEqual(expected);
  expect(
    binary.project.entities.find((row) => row.id === made.entityId),
  ).toBeDefined();
  // JSON is an entity snapshot format; binary is the session/history container.
  // Exercise each timeline snapshot without inventing a JSON session contract.
  for (const [index, scene] of [
    h.state.entities,
    ...h.state.history.map((row) => row.entities),
    ...h.state.future.map((row) => row.entities),
  ].entries()) {
    const json = parseProject(serializeProject(h.state.name, scene));
    expect(
      json.entities
        .filter((row) => row.reference)
        .map((row) => ({
          id: row.id,
          key: row.constructionOrderKey,
          reference: encodeReferenceEntityData(row.reference!),
        })),
    ).toEqual(expected[index]);
  }
});

it("reuses exact accepted records and common bindings when existing pair editing omits sourcePicks", async () => {
  const h = fixture();
  const made = await apply(
    h,
    await located(h, await seed(h), "pair", [
      { entityId: "a" },
      { entityId: "b" },
    ]),
  );
  const accepted = find(h, made.entityId),
    encoded = encodeReferenceEntityData(accepted.reference!);
  const p = await value(
    h.command({
      action: "preview",
      kind: "line",
      entityId: made.entityId,
      mode: "pair",
    }),
  );
  expect(p.definition).toEqual(accepted.reference!.definition);
  expect(p.geometryEncoding).toEqual(encoded.geometry);
  const result = await apply(h, p);
  expect(result.entityId).toBe(made.entityId);
  expect(encodeReferenceEntityData(find(h, made.entityId).reference!)).toEqual(
    encoded,
  );
  expect(h.state.history).toHaveLength(2);
});

it("reuses located F32 suffixes when an owned average preview changes to pair without new picks", async () => {
  const h = fixture();
  const prior = await located(h, await seed(h), "average", [
    { entityId: "x2", parameter: 0.125 },
    { entityId: "x1", parameter: 0.875 },
    { entityId: "x2", parameter: 0.375 },
  ]);
  const p = await value(
    h.command({
      action: "preview",
      kind: "line",
      mode: "pair",
      sessionId: prior.sessionId,
      version: prior.version,
    }),
  );
  expect(p.definition.records).toEqual(prior.definition.records);
  expect(p.definition.sources).toEqual(prior.definition.sources);
  await apply(h, p);
  expect(h.state.history).toHaveLength(1);
});

it("restores retained endpoint-mode records without fabricating source fractions when their sources still exist", async () => {
  const h = fixture();
  const made = await apply(
    h,
    await located(h, await seed(h), "average", [
      { entityId: "x2", parameter: 0.125 },
      { entityId: "x1", parameter: 0.875 },
    ]),
  );
  const retained = (find(h, made.entityId).reference!.definition as any)
    .records;
  const numeric = await value(
    h.command({
      action: "preview",
      kind: "line",
      entityId: made.entityId,
      start: [20, 0, 0],
      end: [30, 0, 0],
    }),
  );
  await apply(h, numeric);
  const restored = await value(
    h.command({
      action: "preview",
      kind: "line",
      entityId: made.entityId,
      mode: "average",
    }),
  );
  expect(restored.definition.records).toEqual(retained);
  expect(restored.definition.sources.map((row: any) => row.id)).toEqual([
    "x1",
    "x2",
  ]);
  expect(
    restored.definition.records.map((row: any) => row.coordinates),
  ).toEqual([
    [1.25, 6, 0],
    [8.75, 2, 0],
  ]);
  const result = await apply(h, restored);
  expect(
    encodeReferenceEntityData(find(h, result.entityId).reference!).geometry,
  ).toEqual(restored.geometryEncoding);
  expect(h.state.history).toHaveLength(3);
});

it("rejects restoring inactive records whose source was deleted, preserving numeric geometry and history", async () => {
  const h = fixture();
  const made = await apply(
    h,
    await located(h, await seed(h), "average", [
      { entityId: "x1", parameter: 0.25 },
      { entityId: "x2", parameter: 0.75 },
    ]),
  );
  const numeric = await value(
    h.command({
      action: "preview",
      kind: "line",
      entityId: made.entityId,
      start: [20, 0, 0],
      end: [30, 0, 0],
    }),
  );
  await apply(h, numeric);
  await value(
    h.api.invoke("object_delete", {
      entityId: "x1",
      expectedRevision: h.api.currentRevision(),
      requestId: "delete-inactive-source",
    }),
  );
  const before = h.state.entities,
    revision = h.api.currentRevision();
  expect(
    await h.command({
      action: "preview",
      kind: "line",
      entityId: made.entityId,
      mode: "average",
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/source|missing|exist/i) },
  });
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toHaveLength(3);
  expect(h.api.currentRevision()).toBe(revision);
});

it("does not treat an empty typed preview as implicitly located source records", async () => {
  const h = fixture(),
    prior = await seed(h);
  expect(
    await h.command({
      action: "preview",
      kind: "line",
      mode: "pair",
      sessionId: prior.sessionId,
      version: prior.version,
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/source|pick|record/i) },
  });
  expect(h.commit).not.toHaveBeenCalled();
  expect(
    await value(h.api.invoke("reference_construction_get", {})),
  ).toMatchObject({
    version: prior.version,
    geometryEncoding: prior.geometryEncoding,
  });
});

it("rejects stale line session versions while retaining the newer exact cached preview", async () => {
  const h = fixture(),
    prior = await located(h, await seed(h), "pair", [
      { entityId: "a" },
      { entityId: "b" },
    ]);
  const next = await located(h, prior, "pair", [
    { entityId: "b" },
    { entityId: "a" },
  ]);
  expect(
    await h.command({
      action: "apply",
      sessionId: prior.sessionId,
      version: prior.version,
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/version|changed/i) },
  });
  expect(h.commit).not.toHaveBeenCalled();
  const result = await apply(h, next);
  expect(
    encodeReferenceEntityData(find(h, result.entityId).reference!).geometry,
  ).toEqual(next.geometryEncoding);
  expect(h.state.history).toHaveLength(1);
});

it("expires derived line previews without changing saved identities or publishing the model", async () => {
  vi.useFakeTimers();
  const h = fixture();
  const before = h.state.entities,
    key = find(h, "a").constructionOrderKey,
    revision = h.api.currentRevision();
  await located(h, await seed(h), "pair", [
    { entityId: "a" },
    { entityId: "b" },
  ]);
  await vi.advanceTimersByTimeAsync(60001);
  expect(
    await value(h.api.invoke("reference_construction_get", {})),
  ).toMatchObject({ active: false, reason: "expired" });
  expect(h.state.entities).toBe(before);
  expect(find(h, "a").constructionOrderKey).toBe(key);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.state.history).toHaveLength(0);
});

it("keeps one accepted derived line when display cleanup fails and retries only its owned cleanup", async () => {
  const h = fixture(),
    p = await located(h, await seed(h), "average", [
      { entityId: "x1", parameter: 0.25 },
      { entityId: "x2", parameter: 0.75 },
    ]);
  let failures = 2;
  h.display.mockImplementation((_owner, candidate) => {
    if (!candidate && failures-- > 0) throw Error("Owned line GPU cleanup");
  });
  const made = await apply(h, p);
  expect(made).toMatchObject({
    cleanupPending: true,
    cleanupError: "Owned line GPU cleanup",
  });
  const accepted = find(h, made.entityId),
    before = h.state.entities;
  expect(encodeReferenceEntityData(accepted.reference!).geometry).toEqual(
    p.geometryEncoding,
  );
  expect(
    await h.command({
      action: "cancel",
      sessionId: p.sessionId,
      version: p.version,
    }),
  ).toMatchObject({ ok: false });
  await cancel(h, p);
  expect(h.state.entities).toBe(before);
  expect(find(h, made.entityId)).toBe(accepted);
  expect(h.state.history).toHaveLength(1);
  expect(h.commit).toHaveBeenCalledOnce();
  expect(h.display.mock.calls.filter((row) => row[1] === null)).toHaveLength(3);
});

it("transforms a numeric semantic source and refreshes its linked line in one commit without changing selection or retained hits", async () => {
  const h = fixture();
  const made = await apply(
    h,
    await located(h, await seed(h), "pair", [
      { entityId: "a" },
      { entityId: "x1", parameter: 0.5 },
    ]),
  );
  const before = h.state.entities,
    history = [...h.state.history],
    retained = encodeReferenceEntityData(
      find(h, made.entityId).reference!,
    ).definition,
    commits = h.commit.mock.calls.length;
  const selection = (h.state.selection = new Uint8Array([1]));
  h.state.selectedId = "x1";
  const revision = h.api.currentRevision();
  const result = await value(
    h.api.invoke("mesh_transform", {
      entityId: "x1",
      translation: [1, 2, 3],
      rotation: [0, 0, 0],
      scale: 1,
      expectedRevision: revision,
      requestId: "transform-linked-semantic-source",
    }),
  );
  expect(result.refreshedEntityIds).toEqual([made.entityId]);
  expect(lineGeometry(h, "x1")).toEqual({
    kind: "line",
    start: [1, 4, 3],
    direction: [1, 0, 0],
    length: 10,
  });
  const linked = lineGeometry(h, made.entityId);
  expect(linked.start).toEqual([1.0000005, 2, -0]);
  const end = referenceLineEnd(linked);
  expect(end[0]).toBeCloseTo(1.0000005, 13);
  expect(end[1]).toBeCloseTo(4, 13);
  expect(end[2]).toBeCloseTo(3, 13);
  expect(
    encodeReferenceEntityData(find(h, made.entityId).reference!).definition,
  ).toEqual(retained);
  expect(h.state.entities).not.toBe(before);
  expect(h.state.history.slice(0, history.length)).toEqual(history);
  expect(h.state.history.at(-1)?.entities).toBe(before);
  expect(h.state.history).toHaveLength(history.length + 1);
  expect(h.commit).toHaveBeenCalledTimes(commits + 1);
  expect(h.state.selection).toBe(selection);
  expect(h.state.selectedId).toBe("x1");
  expect(h.api.currentRevision()).toBe(revision + 1);
  expect(h.host.setSelection).not.toHaveBeenCalled();
});

it("rejects a surface replacement of a linked semantic source without stripping live line dependencies", async () => {
  const h = fixture();
  await apply(
    h,
    await located(h, await seed(h), "pair", [
      { entityId: "a" },
      { entityId: "x1", parameter: 0.5 },
    ]),
  );
  const before = h.state.entities,
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
      entityId: "x1",
      patch,
      expectedRevision: revision,
      requestId: "no-retype-semantic-surface",
    }),
  ).toMatchObject({
    ok: false,
    error: {
      message: expect.stringMatching(/reference|sampled|geometry|semantic/i),
    },
  });
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toHaveLength(1);
  expect(h.api.currentRevision()).toBe(revision);
});

it("bounds derived-line scene work without introducing the limit on ordinary numeric line previews", async () => {
  const h = fixture();
  for (let i = h.state.entities.length; i <= 10000; i++)
    h.state.entities.push({
      id: `bulk-${i}`,
      name: "bulk",
      kind: "pointcloud",
      positions: new Float32Array([i, 0, 0]),
      color: "#ffffff",
      opacity: 1,
      visible: true,
    });
  expect(h.state.entities).toHaveLength(10001);
  const prior = await seed(h),
    before = h.state.entities,
    revision = h.api.currentRevision();
  expect(
    await h.command({
      action: "preview",
      kind: "line",
      mode: "pair",
      sourcePicks: [{ entityId: "a" }, { entityId: "b" }],
      sessionId: prior.sessionId,
      version: prior.version,
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/limit|resource/i) },
  });
  expect(h.state.entities).toBe(before);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.state.history).toHaveLength(0);
  expect(
    await value(h.api.invoke("reference_construction_get", {})),
  ).toMatchObject({
    active: true,
    version: prior.version,
    geometryEncoding: prior.geometryEncoding,
  });
});

it("applies an oblique average using the actual captured prior instead of projecting its cached result again", async () => {
  const h = fixture();
  find(h, "x1").reference!.geometry = {
    kind: "line",
    start: [1.2345, 2.3456, 3.4567],
    direction: [2, 3, 5],
    length: 2.345,
  };
  find(h, "x2").reference!.geometry = {
    kind: "line",
    start: [-4.321, 7.654, -0.123],
    direction: [3, -1, 2],
    length: 4.567,
  };
  const p = await located(h, await seed(h), "average", [
    { entityId: "x1", parameter: 0.125 },
    { entityId: "x2", parameter: 0.875 },
  ]);
  const made = await apply(h, p);
  expect(
    encodeReferenceEntityData(find(h, made.entityId).reference!).geometry,
  ).toEqual(p.geometryEncoding);
  expect(h.state.history).toHaveLength(1);
});

it("replaces the internal evaluation prior only after each successful preview version", async () => {
  const h = fixture();
  find(h, "x1").reference!.geometry = {
    kind: "line",
    start: [1.2345, 2.3456, 3.4567],
    direction: [2, 3, 5],
    length: 2.345,
  };
  find(h, "x2").reference!.geometry = {
    kind: "line",
    start: [-4.321, 7.654, -0.123],
    direction: [3, -1, 2],
    length: 4.567,
  };
  const first = await located(h, await seed(h), "average", [
    { entityId: "x1", parameter: 0.125 },
    { entityId: "x2", parameter: 0.875 },
  ]);
  const numeric = await value(
    h.command({
      action: "preview",
      kind: "line",
      sessionId: first.sessionId,
      version: first.version,
      start: [4, 5, 6],
      end: [14, 6, 7],
    }),
  );
  const latest = await value(
    h.command({
      action: "preview",
      kind: "line",
      mode: "average",
      sessionId: numeric.sessionId,
      version: numeric.version,
    }),
  );
  expect(latest.geometryEncoding).not.toEqual(first.geometryEncoding);
  expect(
    await h.command({
      action: "preview",
      kind: "line",
      mode: "average",
      sessionId: latest.sessionId,
      version: first.version,
    }),
  ).toMatchObject({ ok: false });
  const made = await apply(h, latest);
  expect(
    encodeReferenceEntityData(find(h, made.entityId).reference!).geometry,
  ).toEqual(latest.geometryEncoding);
  expect(h.state.history).toHaveLength(1);
});
