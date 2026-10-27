// Proposed numeric-only transform contract. Source-only preparation; parent owns RED execution.
// Original supplied-matrix payload evidence is distinct from application Euler parameter conversion.
import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
  type CommandContext,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { coordinateAlignmentInterface } from "../src/automation/workflow-operations";
import { lockedObjectEdit } from "../src/object-operations";
import { encodeReferenceEntityData } from "../src/reference-entity";
import { referenceLineEnd } from "../src/reference-construction-values";
import { parseProject, serializeProject } from "../src/io";
import type { Entity, Vec3 } from "../src/types";

const apis: ApplicationApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
  vi.restoreAllMocks();
});

function point(
  id = "point",
  key = "01",
  position: Vec3 = [1 + 2 ** -40, -3, 2 ** -100],
): Entity {
  return {
    id,
    name: id,
    kind: "referencePoint",
    positions: [],
    color: "#123456",
    visible: true,
    opacity: 0.75,
    selectable: true,
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
  const start: Vec3 = [2 + 2 ** -40, 4, 6];
  return {
    ...point("line"),
    kind: "referenceLine",
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "line",
        mode: "endpoints",
        sources: [],
        records: [],
        start,
        end: [18 + 2 ** -40, -20, 10],
      },
      // Imported/stored geometry can retain a raw nonunit direction. Transform must not normalize it.
      geometry: { kind: "line", start, direction: [2, -3, 0.5], length: 8 },
      evaluation: { completionWord: 0x100 },
    },
  };
}
function child(source: Entity, id = "child", key = "02"): Entity {
  return {
    ...point(id, key, [0, 0, 0]),
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "point",
        mode: "center",
        sources: [
          { id: source.id, constructionOrderKey: source.constructionOrderKey! },
        ],
      },
      geometry: { kind: "point", position: [0, 0, 0] },
      evaluation: { completionWord: 0x100 },
    },
  };
}
function setup(entities: Entity[]) {
  const state: WorkspaceSnapshot = {
    name: "Numeric reference transform",
    entities,
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: entities[0].id,
    selection: null,
  };
  const commit = vi.fn<WorkspaceHost["commit"]>((next, label, policy) => {
    if (lockedObjectEdit(state.entities, next, policy))
      throw Error("Locked geometry edit");
    state.history.push({ entities: state.entities, label });
    state.entities = next;
    state.future = [];
  });
  const cad = vi.fn(() => {
    throw Error("Semantic numeric transforms must not allocate CAD");
  });
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad,
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
  };
  const api = new ApplicationApi(host, createOperations(host));
  apis.push(api);
  const request = (extra: Record<string, unknown> = {}) => ({
    entityId: entities[0].id,
    translation: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 2,
    expectedRevision: api.currentRevision(),
    requestId: crypto.randomUUID(),
    ...extra,
  });
  const transform = (extra: Record<string, unknown> = {}) =>
    api.invoke("mesh_transform", request(extra));
  return { state, host, cad, commit, api, request, transform };
}
async function value(
  promise: ReturnType<ApplicationApi["invoke"]>,
): Promise<any> {
  const reply = await promise;
  expect(reply.ok, JSON.stringify(reply)).toBe(true);
  if (!reply.ok) throw Error(reply.error.message);
  return reply.result;
}
function exact(values: readonly number[]): string {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => bytes.writeDoubleLE(value, index * 8));
  return bytes.toString("hex");
}
function find(h: ReturnType<typeof setup>, id: string): Entity {
  return h.state.entities.find((entity) => entity.id === id)!;
}

it("transforms a detached numeric point through MCP without Float32 or editor rounding", async () => {
  const original = point(),
    untouched = point("untouched", "03"),
    h = setup([original, untouched]);
  await value(h.transform());
  const moved = find(h, original.id),
    data = moved.reference!;
  expect(data.geometry.kind).toBe("point");
  if (
    data.geometry.kind !== "point" ||
    data.definition.kind !== "point" ||
    data.definition.mode !== "coordinates"
  )
    throw Error("Wrong kind");
  expect(exact(data.geometry.position)).toBe(
    exact([2 + 2 ** -39, -6, 2 ** -99]),
  );
  expect(exact(data.definition.position)).toBe(exact(data.geometry.position));
  expect(data.definition.sources).toEqual([]);
  expect(data.evaluation.completionWord).toBe(0x100);
  expect(moved).toMatchObject({
    id: original.id,
    name: original.name,
    color: original.color,
    opacity: original.opacity,
    constructionOrderKey: original.constructionOrderKey,
  });
  expect(find(h, untouched.id)).toBe(untouched);
  expect(original.reference!.geometry).toEqual({
    kind: "point",
    position: [1 + 2 ** -40, -3, 2 ** -100],
  });
  expect(h.commit).toHaveBeenCalledOnce();
  expect(h.cad).not.toHaveBeenCalled();
});

it("scales raw line direction while preserving its exact stored length and synchronizing endpoint definition", async () => {
  const original = line(),
    h = setup([original]);
  await value(h.transform({ translation: [10, -5, 2] }));
  const data = find(h, "line").reference!,
    geometry = data.geometry,
    definition = data.definition;
  expect(geometry.kind).toBe("line");
  if (
    geometry.kind !== "line" ||
    definition.kind !== "line" ||
    definition.mode !== "endpoints"
  )
    throw Error("Wrong kind");
  expect(
    exact([...geometry.start, ...geometry.direction, geometry.length]),
  ).toBe(exact([14 + 2 ** -39, 3, 14, 4, -6, 1, 8]));
  expect(exact(definition.start)).toBe(exact(geometry.start));
  expect(exact(definition.end)).toBe(exact(referenceLineEnd(geometry)));
  expect(definition.records).toEqual([]);
  expect(definition.sources).toEqual([]);
  expect(data.evaluation.completionWord).toBe(0x100);
  expect(original.reference!.geometry).toEqual({
    kind: "line",
    start: [2 + 2 ** -40, 4, 6],
    direction: [2, -3, 0.5],
    length: 8,
  });
  expect(h.cad).not.toHaveBeenCalled();
});

it("does not translate line direction or replace length when only moving the origin", async () => {
  const h = setup([line()]);
  await value(h.transform({ scale: 1, translation: [10, -5, 2] }));
  const geometry = find(h, "line").reference!.geometry;
  if (geometry.kind !== "line") throw Error("Wrong kind");
  expect(exact(geometry.direction)).toBe(exact([2, -3, 0.5]));
  expect(exact([geometry.length])).toBe(exact([8]));
});

it("uses degree rotation before world translation in the existing mesh_transform parameter contract", async () => {
  const h = setup([point("point", "01", [1, 0, 0])]);
  await value(
    h.transform({ scale: 1, rotation: [0, 0, 90], translation: [0, 3, 2] }),
  );
  const geometry = find(h, "point").reference!.geometry;
  if (geometry.kind !== "point") throw Error("Wrong kind");
  // Application Euler conversion, not an original toolbar trigonometry claim.
  expect(exact(geometry.position)).toBe(exact([6.123233995736766e-17, 4, 2]));
});

it("refreshes the full admitted descendant chain once, with reversible history and immutable prior snapshots", async () => {
  const root = line(),
    middle = child(root),
    leaf = child(middle, "leaf", "03");
  const h = setup([root, middle, leaf]),
    before = h.state.entities;
  const result = await value(h.transform({ translation: [10, -5, 2] }));
  expect(result.refreshedEntityIds).toEqual(["child", "leaf"]);
  expect(find(h, "child").reference!.geometry).toEqual({
    kind: "point",
    position: [30 + 2 ** -39, -21, 18],
  });
  expect(find(h, "leaf").reference!.geometry).toEqual(
    find(h, "child").reference!.geometry,
  );
  expect(middle.reference!.geometry).toEqual({
    kind: "point",
    position: [0, 0, 0],
  });
  expect(h.state.history).toHaveLength(1);
  expect(h.state.history[0].entities).toBe(before);
  const after = h.state.entities;
  await value(
    h.api.invoke("history_undo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "undo",
    }),
  );
  expect(h.state.entities).toBe(before);
  await value(
    h.api.invoke("history_redo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "redo",
    }),
  );
  expect(h.state.entities).toBe(after);
});

it("refreshes a located point-pair line after transforming its numeric point source", async () => {
  const root = point("point", "01", [0, 0, 0]),
    other = point("other", "02", [10, 0, 0]);
  const derived: Entity = {
    ...line(),
    id: "derived",
    constructionOrderKey: "03".repeat(16),
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "line",
        mode: "pair",
        sources: [root, other].map((source) => ({
          id: source.id,
          constructionOrderKey: source.constructionOrderKey!,
        })),
        records: [
          {
            entityId: root.id,
            storage: "native-pick-record-f32",
            coordinates: [0, 0, 0],
          },
          {
            entityId: other.id,
            storage: "native-pick-record-f32",
            coordinates: [10, 0, 0],
          },
        ],
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
  const h = setup([root, other, derived]);
  const result = await value(h.transform({ scale: 1, translation: [2, 0, 0] }));
  expect(result.refreshedEntityIds).toEqual([derived.id]);
  expect(find(h, derived.id).reference!.geometry).toEqual({
    kind: "line",
    start: [2, 0, 0],
    direction: [1, 0, 0],
    length: 8,
  });
  expect(find(h, derived.id).reference!.definition).toEqual(
    derived.reference!.definition,
  );
  expect(find(h, other.id)).toBe(other);
  expect(h.commit).toHaveBeenCalledOnce();
});

it("refreshes an average line using retained hits without transforming those records", async () => {
  const root = line();
  root.reference!.geometry = {
    kind: "line",
    start: [0, 0, 0],
    direction: [1, 0, 0],
    length: 10,
  };
  root.reference!.definition = {
    version: 1,
    kind: "line",
    mode: "endpoints",
    sources: [],
    records: [],
    start: [0, 0, 0],
    end: [10, 0, 0],
  };
  const other: Entity = {
    ...root,
    id: "other",
    constructionOrderKey: "02".repeat(16),
    reference: {
      ...root.reference!,
      definition: {
        version: 1,
        kind: "line",
        mode: "endpoints",
        sources: [],
        records: [],
        start: [0, 4, 0],
        end: [10, 4, 0],
      },
      geometry: {
        kind: "line",
        start: [0, 4, 0],
        direction: [1, 0, 0],
        length: 10,
      },
    },
  };
  const derived: Entity = {
    ...root,
    id: "average",
    constructionOrderKey: "03".repeat(16),
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "line",
        mode: "average",
        sources: [root, other].map((source) => ({
          id: source.id,
          constructionOrderKey: source.constructionOrderKey!,
        })),
        records: [
          {
            entityId: root.id,
            storage: "native-pick-record-f32",
            coordinates: [0, 0, 0],
          },
          {
            entityId: other.id,
            storage: "native-pick-record-f32",
            coordinates: [0, 4, 0],
          },
        ],
      },
      geometry: {
        kind: "line",
        start: [0, 2, 0],
        direction: [1, 0, 0],
        length: 10,
      },
      evaluation: { completionWord: 0x100 },
    },
  };
  const h = setup([root, other, derived]);
  const result = await value(h.transform({ scale: 1, translation: [0, 4, 0] }));
  expect(result.refreshedEntityIds).toEqual([derived.id]);
  const geometry = find(h, derived.id).reference!.geometry;
  if (geometry.kind !== "line") throw Error("Wrong kind");
  expect(geometry.start[1]).toBe(4);
  expect(referenceLineEnd(geometry)[1]).toBe(4);
  expect(find(h, derived.id).reference!.definition).toEqual(
    derived.reference!.definition,
  );
  expect(h.commit).toHaveBeenCalledOnce();
});

it.each(["root", "dependent"])(
  "rejects a locked %s without partial geometry, history or revision changes",
  async (locked) => {
    const root = point(),
      dependent = child(root);
    if (locked === "root") root.locked = true;
    else dependent.locked = true;
    const h = setup([root, dependent]),
      before = h.state.entities,
      revision = h.api.currentRevision();
    const result = await h.transform();
    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/locked/i) },
    });
    expect(h.state.entities).toBe(before);
    expect(h.state.history).toEqual([]);
    expect(h.state.future).toEqual([]);
    expect(h.api.currentRevision()).toBe(revision);
    expect(h.commit).not.toHaveBeenCalled();
  },
);

it.each(["derived-point", "derived-line", "inactive-line-record"])(
  "keeps unproved %s source and pick policies gated",
  async (mode) => {
    const source = point("source", "02", [1, 2, 3]);
    let root = mode === "derived-point" ? child(source, "root", "01") : line();
    if (mode !== "derived-point") {
      const data = root.reference!;
      if (data.definition.kind !== "line") throw Error("Wrong kind");
      data.definition =
        mode === "derived-line"
          ? {
              version: 1,
              kind: "line",
              mode: "pair",
              sources: [
                {
                  id: source.id,
                  constructionOrderKey: source.constructionOrderKey!,
                },
              ],
              records: [
                {
                  entityId: source.id,
                  storage: "native-pick-record-f32",
                  coordinates: [1, -0, 3],
                },
              ],
            }
          : {
              ...data.definition,
              records: [
                {
                  entityId: source.id,
                  storage: "native-pick-record-f32",
                  coordinates: [1, -0, 3],
                },
              ],
            };
    }
    const h = setup([root, source]),
      before = h.state.entities,
      encoded = encodeReferenceEntityData(root.reference!);
    const result = await h.transform();
    expect(result.ok).toBe(false);
    expect(h.state.entities).toBe(before);
    expect(encodeReferenceEntityData(root.reference!)).toEqual(encoded);
    expect(h.commit).not.toHaveBeenCalled();
  },
);

it.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN])(
  "rejects nonpositive or nonfinite scale %s atomically",
  async (scale) => {
    const h = setup([point()]),
      before = h.state.entities;
    expect((await h.transform({ scale })).ok).toBe(false);
    expect(h.state.entities).toBe(before);
    expect(h.commit).not.toHaveBeenCalled();
  },
);

it("rejects an out-of-bounds reconstructed line endpoint even when the transformed origin is in range", async () => {
  const root = line();
  root.reference!.geometry = {
    kind: "line",
    start: [0, 0, 0],
    direction: [1, 0, 0],
    length: 750_000_000,
  };
  root.reference!.definition = {
    version: 1,
    kind: "line",
    mode: "endpoints",
    sources: [],
    records: [],
    start: [0, 0, 0],
    end: [750_000_000, 0, 0],
  };
  const h = setup([root]),
    before = h.state.entities;
  expect((await h.transform()).ok).toBe(false);
  expect(h.state.entities).toBe(before);
  expect(h.commit).not.toHaveBeenCalled();
});

it("shares revision/retry protection without a second transform or history entry", async () => {
  const h = setup([point()]),
    args = h.request({ requestId: "same-transform" });
  const first = await value(h.api.invoke("mesh_transform", args));
  const after = h.state.entities;
  expect(await value(h.api.invoke("mesh_transform", args))).toEqual(first);
  expect(h.state.entities).toBe(after);
  expect(h.commit).toHaveBeenCalledOnce();
  expect(
    (
      await h.api.invoke("mesh_transform", {
        ...args,
        requestId: "stale-transform",
      })
    ).ok,
  ).toBe(false);
  expect(h.state.entities).toBe(after);
  expect(h.commit).toHaveBeenCalledOnce();
});

it("checks shared cancellation before any semantic transform publication", async () => {
  const h = setup([point()]),
    before = h.state.entities;
  const controller = new AbortController();
  controller.abort();
  const check = () => {
    throw new DOMException("Cancelled", "AbortError");
  };
  const context: CommandContext = {
    signal: controller.signal,
    check,
    progress: vi.fn(),
    artifact: vi.fn(),
    artifactBlob: vi.fn(),
    mutate: (write) => {
      check();
      write();
    },
  };
  await expect(
    Promise.resolve().then(() =>
      createOperations(h.host).mesh_transform(h.request(), context),
    ),
  ).rejects.toThrow();
  expect(h.state.entities).toBe(before);
  expect(h.commit).not.toHaveBeenCalled();
});

it.each(["point", "line"])(
  "persists both exact %s payload and numeric definition after transform",
  async (kind) => {
    const root = kind === "point" ? point() : line(),
      h = setup([root]);
    await value(h.transform({ translation: [10, -5, 2] }));
    const moved = find(h, root.id),
      encoded = encodeReferenceEntityData(moved.reference!);
    const restored = parseProject(
      serializeProject(h.state.name, h.state.entities),
    );
    expect(encodeReferenceEntityData(restored.entities[0].reference!)).toEqual(
      encoded,
    );
    expect(restored.entities[0].constructionOrderKey).toBe(
      root.constructionOrderKey,
    );
  },
);

it.each([point(), line()])(
  "allows the shared GUI/interface transform workspace for detached numeric $kind",
  (entity) => {
    expect(
      coordinateAlignmentInterface(
        { workspace: "transform", toolPanelOpen: true },
        entity,
      ),
    ).toEqual({ workspace: "transform", toolPanelOpen: true });
  },
);

it("keeps derived semantic GUI transform workspace gated without enabling sampled workflows", () => {
  const root = point(),
    derived = child(root);
  expect(() =>
    coordinateAlignmentInterface({ workspace: "transform" }, derived),
  ).toThrow();
  for (const workspace of ["mesh", "fit", "section", "scanTools"]) {
    expect(() => coordinateAlignmentInterface({ workspace }, root)).toThrow();
  }
});
