import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { placedCloud, cloudPoseBits } from "../src/point-cloud-placement";
import { encodeReferenceEntityData } from "../src/reference-entity";
import {
  encodeReferenceGeometry,
  decodeReferenceGeometry,
} from "../src/reference-construction-values";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
} from "../src/project-file-codec";
import { serializeProject, parseProject } from "../src/io";
import type { Entity } from "../src/types";

// First admitted acquisition family only. It is a read-only application cloud
// vertex selector + recovered mm/N6 float-controller bake, not all native picks.
const apis: ApplicationApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
  vi.restoreAllMocks();
});
function cloud(): Entity {
  return {
    id: "cloud",
    name: "Cloud",
    kind: "pointcloud",
    positions: [1.0000005, -3e-7, 0.0078125, 42, 43, 44],
    normals: new Float32Array([0, 0, 1, 0, 1, 0]),
    pointColors: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]),
    visible: true,
    color: "#abcdef",
    opacity: 1,
  };
}
function setup(entities = [cloud()]) {
  const state: WorkspaceSnapshot = {
    name: "Baked cloud coordinates",
    entities,
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: null,
    selection: null,
  };
  const display = vi.fn();
  const commit = vi.fn<WorkspaceHost["commit"]>((next, label) => {
    state.history.push({ entities: state.entities, label });
    state.entities = next;
    state.future = [];
  });
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => {
      throw Error("No CAD for cloud vertex acquisition");
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
  const pick = (args: Record<string, unknown> = {}) =>
    api.invoke("reference_construction_pick", {
      entityId: "cloud",
      pointIndex: 0,
      ...args,
    });
  const construct = (args: Record<string, unknown>) =>
    api.invoke("reference_construct", {
      ...args,
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
  return { state, host, api, pick, construct, commit, display };
}
async function value(
  promise: ReturnType<ApplicationApi["invoke"]>,
): Promise<any> {
  const reply = await promise;
  expect(reply.ok, JSON.stringify(reply)).toBe(true);
  if (!reply.ok) throw Error(reply.error.message);
  return reply.result;
}
function f32bits(value: number) {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  return view.getUint32(0, true).toString(16).padStart(8, "0");
}

it("discovers a read-only direct-index acquisition tool with no caller-authored coordinates, state or provenance", async () => {
  const h = setup();
  const tools = await value(
    h.api.invoke("tools_search", {
      query: "reference_construction_pick",
      includeSchemas: true,
      limit: 20,
    }),
  );
  const descriptor = tools.tools.find(
    (row: any) => row.name === "reference_construction_pick",
  );
  expect(descriptor).toMatchObject({ readOnly: true, job: false });
  expect(descriptor.inputSchema.required).toEqual(["entityId", "pointIndex"]);
  expect(Object.keys(descriptor.inputSchema.properties).sort()).toEqual([
    "entityId",
    "pointIndex",
  ]);
  expect(descriptor.inputSchema.additionalProperties).toBe(false);
});

it("returns native float-controller bake bits without mutating source buffers, revision, selection or history", async () => {
  const h = setup(),
    source = h.state.entities[0],
    positions = source.positions,
    normals = source.normals!,
    colors = source.pointColors!;
  h.state.selectedId = "cloud";
  h.state.selection = new Uint8Array([0, 1]);
  const selection = h.state.selection,
    revision = h.api.currentRevision(),
    before = h.state.entities;
  const positionBytes = Array.from(positions),
    normalBytes = Array.from(normals),
    colorBytes = Array.from(colors);
  const receipt = await h.pick();
  expect(receipt).toMatchObject({ ok: true, revision });
  if (!receipt.ok) throw Error(receipt.error.message);
  const result = receipt.result as any;
  expect(result).toMatchObject({
    entityId: "cloud",
    pointIndex: 0,
    units: "mm",
    coordinateSpace: "world",
    acquisition: "point-cloud-vertex",
    numericOnly: true,
    sourceDependencyRetained: false,
  });
  // Independent analytic goldens from the quantizer contract, not toFixed/fround
  // or a call to the implementation under test. Tiny negative Y retains -0.
  expect(result.position.map(f32bits)).toEqual([
    "3f800000",
    "80000000",
    "3c000219",
  ]);
  expect(Object.is(result.position[1], -0)).toBe(true);
  expect((await value(h.pick())).position.map(f32bits)).toEqual([
    "3f800000",
    "80000000",
    "3c000219",
  ]);
  result.position[0] = 999;
  expect((await value(h.pick())).position[0]).toBe(1);
  expect(source.positions).toBe(positions);
  expect(source.normals).toBe(normals);
  expect(source.pointColors).toBe(colors);
  expect(Array.from(positions)).toEqual(positionBytes);
  expect(Array.from(normals)).toEqual(normalBytes);
  expect(Array.from(colors)).toEqual(colorBytes);
  expect(h.state.entities).toBe(before);
  expect(h.state.selection).toBe(selection);
  expect(h.api.currentRevision()).toBe(revision);
  expect(source.constructionOrderKey).toBeUndefined();
  expect(h.commit).not.toHaveBeenCalled();
  expect(h.display).not.toHaveBeenCalled();
  expect(h.host.setSelection).not.toHaveBeenCalled();
});

it("resolves one placed-cloud source index without reading materialized world positions or normals", async () => {
  const local = [1, 2, 3, 40, 50, 60],
    normals = new Float32Array([0, 0, 1, 0, 1, 0]);
  const matrix = [1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30];
  const source = placedCloud(
    { ...cloud(), positions: local, normals },
    {
      sourcePositions: local,
      sourceNormals: normals,
      matrixBits: cloudPoseBits(matrix),
    },
  );
  const worldPositions = vi.fn(() => {
    throw Error("Whole placed-cloud world positions must not be read");
  });
  const worldNormals = vi.fn(() => {
    throw Error("Whole placed-cloud world normals must not be read");
  });
  Object.defineProperties(source, {
    positions: { enumerable: true, configurable: true, get: worldPositions },
    normals: { enumerable: true, configurable: true, get: worldNormals },
  });
  const h = setup([source]);
  expect(await value(h.pick({ pointIndex: 0 }))).toMatchObject({
    position: [11, 22, 33],
  });
  expect(await value(h.pick({ pointIndex: 1 }))).toMatchObject({
    position: [50, 70, 90],
  });
  expect(worldPositions).not.toHaveBeenCalled();
  expect(worldNormals).not.toHaveBeenCalled();
  expect(Array.from(local)).toEqual([1, 2, 3, 40, 50, 60]);
  expect(Array.from(normals)).toEqual([0, 0, 1, 0, 1, 0]);
  expect(h.commit).not.toHaveBeenCalled();
  expect(h.state.history).toEqual([]);
});

it.each([
  { pointIndex: -1 },
  { pointIndex: 0.5 },
  { pointIndex: 2 },
  { pointIndex: Number.MAX_SAFE_INTEGER + 1 },
  { pointIndex: NaN },
  { entityId: "missing" },
  { position: [99, 99, 99] },
  { world: [99, 99, 99] },
  { constructionOrderKey: "ff".repeat(16) },
  { completionWord: 256 },
  { provenance: { acquisition: "point-cloud-vertex" } },
  { coordinateSpace: "world" },
])(
  "rejects invalid/injected acquisition input atomically: %j",
  async (args) => {
    const h = setup(),
      before = h.state.entities,
      revision = h.api.currentRevision();
    const reply = await h.pick(args);
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

it.each([{ visible: false }, { locked: true }, { selectable: false }])(
  "matches viewport read eligibility: %j",
  async (patch) => {
    const source = { ...cloud(), ...patch },
      h = setup([source]),
      revision = h.api.currentRevision();
    const reply = await h.pick();
    expect(reply).toMatchObject({ ok: false });
    if (!reply.ok)
      expect(reply.error.message).toMatch(
        /pick|visible|locked|select|eligible/i,
      );
    expect(h.state.entities[0]).toBe(source);
    expect(h.api.currentRevision()).toBe(revision);
    expect(h.commit).not.toHaveBeenCalled();
  },
);
it.each(["mesh", "cad", "plane"] as const)(
  "keeps unsupported %s acquisition gated",
  async (kind) => {
    const h = setup([{ ...cloud(), kind }]);
    const reply = await h.pick();
    expect(reply).toMatchObject({ ok: false });
    if (!reply.ok)
      expect(reply.error.message).toMatch(/cloud|unsupported|source|family/i);
    expect(h.commit).not.toHaveBeenCalled();
  },
);
it.each([NaN, Infinity, 1e9 + 1])(
  "rejects invalid selected source coordinates %j without baking an origin",
  async (coordinate) => {
    const source = {
        ...cloud(),
        positions: [coordinate, 0, 0],
      },
      h = setup([source]);
    expect(await h.pick()).toMatchObject({ ok: false });
    expect(h.state.entities[0]).toBe(source);
    expect(h.commit).not.toHaveBeenCalled();
  },
);
it("rejects ambiguous duplicate source IDs", async () => {
  const source = cloud(),
    h = setup([source, { ...source }]);
  const reply = await h.pick();
  expect(reply).toMatchObject({ ok: false });
  if (!reply.ok)
    expect(reply.error.message).toMatch(/duplicate|unique|identity|ambiguous/i);
  expect(h.commit).not.toHaveBeenCalled();
});

it.each(["point", "line"] as const)(
  "bakes picked %s coordinates through existing numeric Preview/Apply with no retained source dependency",
  async (kind) => {
    const h = setup(),
      original = h.state.entities[0],
      originalPositions = original.positions;
    const picked = await value(h.pick());
    const preview = await value(
      h.construct({
        action: "preview",
        kind,
        ...(kind === "point"
          ? { position: picked.position }
          : { start: picked.position, end: [5, 0, 0] }),
      }),
    );
    const applied = await value(
      h.construct({
        action: "apply",
        sessionId: preview.sessionId,
        version: preview.version,
      }),
    );
    const baked = h.state.entities.find((row) => row.id === applied.entityId)!;
    expect(baked.reference!.definition.sources).toEqual([]);
    expect(baked.reference!.definition.mode).toBe(
      kind === "point" ? "coordinates" : "endpoints",
    );
    if (baked.reference!.definition.kind === "line")
      expect(baked.reference!.definition.records).toEqual([]);
    const encoded = encodeReferenceEntityData(baked.reference!);
    expect(h.state.history).toHaveLength(1);
    expect(original.constructionOrderKey).toBeUndefined();
    h.state.selectedId = "cloud";
    h.state.selection = new Uint8Array([1, 0]);
    await value(
      h.api.invoke("selection_edit", {
        entityId: "cloud",
        operation: "delete",
        expectedRevision: h.api.currentRevision(),
        requestId: "edit-picked-cloud-source",
      }),
    );
    expect(h.state.entities.find((row) => row.id === applied.entityId)).toBe(
      baked,
    );
    expect(Array.from(originalPositions)).toEqual([
      1.0000005, -3e-7, 0.0078125, 42, 43, 44,
    ]);
    expect(
      h.state.entities.find((row) => row.id === "cloud")!.positions.length,
    ).toBe(3);
    const session = {
      project: {
        format: "maliev-scanforge" as const,
        version: 1 as const,
        name: h.state.name,
        units: "mm" as const,
        entities: h.state.entities,
      },
      history: h.state.history,
      future: h.state.future,
    };
    const reopened = await decodeProjectContents(
      await encodeProjectFileLocally(session),
    );
    expect(
      encodeReferenceEntityData(
        reopened.project.entities.find((row) => row.id === applied.entityId)!
          .reference!,
      ),
    ).toEqual(encoded);
    const json = parseProject(serializeProject(h.state.name, h.state.entities));
    expect(
      encodeReferenceEntityData(
        json.entities.find((row) => row.id === applied.entityId)!.reference!,
      ),
    ).toEqual(encoded);
    await value(
      h.api.invoke("history_undo", {
        expectedRevision: h.api.currentRevision(),
        requestId: "undo-cloud-edit",
      }),
    );
    expect(h.state.entities.find((row) => row.id === "cloud")!.positions).toBe(
      originalPositions,
    );
    expect(
      encodeReferenceEntityData(
        h.state.entities.find((row) => row.id === applied.entityId)!.reference!,
      ),
    ).toEqual(encoded);
    await value(
      h.api.invoke("history_undo", {
        expectedRevision: h.api.currentRevision(),
        requestId: "undo-picked-reference",
      }),
    );
    expect(
      h.state.entities.find((row) => row.id === applied.entityId),
    ).toBeUndefined();
    await value(
      h.api.invoke("history_redo", {
        expectedRevision: h.api.currentRevision(),
        requestId: "redo-picked-reference",
      }),
    );
    expect(
      encodeReferenceEntityData(
        h.state.entities.find((row) => row.id === applied.entityId)!.reference!,
      ),
    ).toEqual(encoded);
  },
);

it("exposes lossless picked-coordinate encoding and resolves a point intent after JSON loses numeric negative zero", async () => {
  const h = setup();
  const receipt = await h.pick();
  expect(receipt.ok).toBe(true);
  if (!receipt.ok) throw Error(receipt.error.message);
  const wire = JSON.parse(JSON.stringify(receipt));
  expect(Object.is(wire.result.position[1], -0)).toBe(false);
  const expected = encodeReferenceGeometry({
    kind: "point",
    // Independent Decimal.from_float + precision15 ROUND_HALF_UP result after
    // the preceding Float32 acquisition (raw LE f32 1902003c).
    position: [1, -0, 0.00781300012022257],
  });
  expect(wire.result.positionEncoding).toEqual(expected);
  const decoded = decodeReferenceGeometry(wire.result.positionEncoding);
  expect(decoded.kind).toBe("point");
  if (decoded.kind !== "point") throw Error("Expected a coordinate point");
  expect(Object.is(decoded.position[1], -0)).toBe(true);
  // Supply source intent, never the lossy JSON array or caller-authored bits.
  const preview = await value(
    h.api.invoke("reference_construct", {
      action: "preview",
      kind: "point",
      positionPick: { entityId: "cloud", pointIndex: 0 },
      expectedRevision: wire.revision,
      requestId: "lossless-point-pick-preview",
    }),
  );
  expect(preview.geometryEncoding).toEqual(expected);
  const inspected = JSON.parse(
    JSON.stringify(await value(h.api.invoke("reference_construction_get", {}))),
  );
  expect(inspected.geometryEncoding).toEqual(expected);
  const applied = await value(
    h.construct({
      action: "apply",
      sessionId: preview.sessionId,
      version: preview.version,
    }),
  );
  const entity = h.state.entities.find((row) => row.id === applied.entityId)!;
  expect(entity.reference!.definition).toMatchObject({
    kind: "point",
    mode: "coordinates",
    sources: [],
  });
  expect(encodeReferenceGeometry(entity.reference!.geometry)).toEqual(expected);
  expect(
    entity.reference!.definition.kind === "point" &&
      entity.reference!.definition.mode === "coordinates" &&
      Object.is(entity.reference!.definition.position[1], -0),
  ).toBe(true);
  expect(h.state.history).toHaveLength(1);
  h.state.selectedId = "cloud";
  h.state.selection = new Uint8Array([1, 0]);
  await value(
    h.api.invoke("selection_edit", {
      entityId: "cloud",
      operation: "delete",
      expectedRevision: h.api.currentRevision(),
      requestId: "delete-baked-point-source",
    }),
  );
  expect(h.state.entities.find((row) => row.id === applied.entityId)).toBe(
    entity,
  );
  expect(encodeReferenceGeometry(entity.reference!.geometry)).toEqual(expected);
});

it.each([
  {
    name: "picked start and typed end",
    fields: { startPick: { entityId: "cloud", pointIndex: 0 }, end: [5, 0, 0] },
    pickedField: "start",
  },
  {
    name: "typed start and picked end",
    fields: { start: [5, 0, 0], endPick: { entityId: "cloud", pointIndex: 0 } },
    pickedField: "end",
  },
  {
    name: "two independently picked endpoints",
    fields: {
      startPick: { entityId: "cloud", pointIndex: 0 },
      endPick: { entityId: "cloud", pointIndex: 1 },
    },
    pickedField: "start",
  },
])(
  "stores %s as numeric endpoints with no source links or fabricated retained records",
  async ({ fields, pickedField }) => {
    const h = setup();
    const preview = await value(
      h.construct({ action: "preview", kind: "line", ...fields }),
    );
    expect(preview.definition).toMatchObject({
      kind: "line",
      mode: "endpoints",
      sources: [],
      records: [],
    });
    expect(Object.is(preview.definition[pickedField][1], -0)).toBe(true);
    expect(preview.geometryEncoding).toEqual(
      encodeReferenceGeometry(preview.geometry),
    );
    const applied = await value(
      h.construct({
        action: "apply",
        sessionId: preview.sessionId,
        version: preview.version,
      }),
    );
    const saved = h.state.entities.find(
      (row) => row.id === applied.entityId,
    )!.reference!;
    expect(saved.definition.kind).toBe("line");
    if (
      saved.definition.kind !== "line" ||
      saved.definition.mode !== "endpoints"
    )
      throw Error("Expected stored endpoint line");
    expect(saved.definition.sources).toEqual([]);
    expect(saved.definition.records).toEqual([]);
    expect(
      Object.is(saved.definition[pickedField as "start" | "end"][1], -0),
    ).toBe(true);
    expect(h.state.entities[0].constructionOrderKey).toBeUndefined();
    expect(h.state.history).toHaveLength(1);
  },
);

it("rejects a captured pick revision after its source changes instead of quietly resolving a newer vertex", async () => {
  const h = setup();
  const picked = await h.pick();
  expect(picked.ok).toBe(true);
  h.state.entities = h.state.entities.map((row) =>
    row.id === "cloud" ? { ...row, positions: [100, 200, 300] } : row,
  );
  const before = h.state.entities;
  expect(
    await h.api.invoke("reference_construct", {
      action: "preview",
      kind: "point",
      positionPick: { entityId: "cloud", pointIndex: 0 },
      expectedRevision: picked.revision,
      requestId: "stale-pick-intent",
    }),
  ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  expect(h.state.entities).toBe(before);
  expect(h.commit).not.toHaveBeenCalled();
  expect(h.display).not.toHaveBeenCalled();
});

it.each([
  {
    kind: "point",
    position: [1, 2, 3],
    positionPick: { entityId: "cloud", pointIndex: 0 },
  },
  {
    kind: "line",
    start: [1, 2, 3],
    startPick: { entityId: "cloud", pointIndex: 0 },
    end: [5, 0, 0],
  },
  {
    kind: "line",
    start: [5, 0, 0],
    end: [1, 2, 3],
    endPick: { entityId: "cloud", pointIndex: 0 },
  },
  { kind: "point", startPick: { entityId: "cloud", pointIndex: 0 } },
  { kind: "point", endPick: { entityId: "cloud", pointIndex: 0 } },
  {
    kind: "line",
    positionPick: { entityId: "cloud", pointIndex: 0 },
    end: [5, 0, 0],
  },
  {
    kind: "point",
    mode: "center",
    sourceEntityIds: [],
    positionPick: { entityId: "cloud", pointIndex: 0 },
  },
  {
    kind: "point",
    positionPick: { entityId: "cloud", pointIndex: 0, position: [1, 2, 3] },
  },
  {
    kind: "point",
    positionPick: { entityId: "cloud", pointIndex: 0 },
    positionEncoding: { version: 1, kind: "point", bits: "00".repeat(24) },
  },
])(
  "rejects ambiguous or caller-authored picked construction fields: %j",
  async (fields) => {
    const h = setup(),
      before = h.state.entities,
      revision = h.api.currentRevision();
    const reply = await h.construct({ action: "preview", ...fields });
    expect(reply).toMatchObject({ ok: false });
    if (!reply.ok)
      expect(["INVALID_ARGUMENT", "OPERATION_FAILED"]).toContain(
        reply.error.code,
      );
    expect(h.state.entities).toBe(before);
    expect(h.api.currentRevision()).toBe(revision);
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.display).not.toHaveBeenCalled();
  },
);
