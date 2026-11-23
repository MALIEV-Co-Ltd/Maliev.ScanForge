import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReferenceConstructionDefinition } from "../src/reference-construction";
import type { ReferenceConstructionState } from "../src/reference-construction-evaluation";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import type { Entity } from "../src/types";
import { lockedObjectEdit } from "../src/object-operations";
import { resolveConstructionIdentities } from "../src/reference-construction-identity";
import {
  beginReferenceConstructionPreview,
  inspectReferenceConstructionPreview,
  releaseReferenceConstructionPreview,
} from "../src/automation/reference-construction-preview";
import { applyReferenceConstructionToWorkspace } from "../src/automation/reference-construction-apply";
import { datumEntityDependencies } from "../src/datum-dependencies";
const apis: ApplicationApi[] = [];
const mesh = (id: string, locked = false): Entity => ({
  id,
  name: id,
  kind: "mesh",
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  color: "#aaaaaa",
  opacity: 1,
  visible: true,
  locked,
});
const target = {
  kind: "create" as const,
  id: "new-point",
  name: "Reference point",
  color: "#ffbb44",
  opacity: 1,
};
const referencePoint = (locked = false): Entity => ({
  ...mesh("existing", locked),
  kind: "referencePoint",
  positions: [],
  constructionOrderKey: "11".repeat(16),
  reference: {
    version: 1,
    definition: {
      version: 1,
      kind: "point",
      mode: "coordinates",
      position: [5, 5, 5],
      sources: [],
    },
    geometry: { kind: "point", position: [5, 5, 5] },
    evaluation: { completionWord: 256 },
  },
});
function setup(
  entities: Entity[] = [mesh("locked-source", true), mesh("unselected")],
  options: {
    definition?: ReferenceConstructionDefinition;
    prior?: ReferenceConstructionState;
    evaluationAllowed?: boolean;
  } = {},
) {
  const state: WorkspaceSnapshot = {
    name: "Apply",
    entities,
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: null,
    selection: null,
  };
  const commit = vi.fn<WorkspaceHost["commit"]>((next, label, policy) => {
    const locked = lockedObjectEdit(state.entities, next, policy);
    if (locked) throw Error("Locked object: " + locked.id);
    state.history = [...state.history, { entities: state.entities, label }];
    state.entities = next;
    state.future = [];
  });
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => {
      throw Error("No kernel");
    },
    commit,
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
    inspectApplication: () => ({ previews: {} }),
  };
  const clear = vi.fn();
  const sources = resolveConstructionIdentities(
    entities,
    entities.some((e) => e.id === "locked-source") ? ["locked-source"] : [],
  ).orderedSources;
  const preview = beginReferenceConstructionPreview(
    host,
    { show: vi.fn(), clear },
    options.prior ?? {
      geometry: { kind: "point", position: [0, 0, 0] },
      state: { completionWord: 0 },
    },
    {
      definition: options.definition ?? {
        version: 1,
        kind: "point",
        mode: "coordinates",
        position: [-0, 2, 3],
        sources,
      },
      writeNumericInputs: true,
      evaluationAllowed: options.evaluationAllowed ?? true,
    },
  );
  let destination: Parameters<
    typeof applyReferenceConstructionToWorkspace
  >[2]["target"] = target;
  let version = preview.version;
  const api = new ApplicationApi(host, {
    object_update: (_a, c) =>
      applyReferenceConstructionToWorkspace(host, c, {
        owner: preview.sessionId,
        version,
        target: destination,
      }),
  });
  apis.push(api);
  const args = () => ({
    entityId: "fixture",
    patch: {},
    expectedRevision: api.currentRevision(),
    requestId: crypto.randomUUID(),
  });
  return {
    api,
    host,
    state,
    commit,
    clear,
    preview,
    args,
    setVersion: (next: number) => {
      version = next;
    },
    setTarget: (next: typeof destination) => {
      destination = next;
    },
    apply: () => api.invoke("object_update", args()),
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
it("publishes cached numeric geometry without retaining or migrating inactive sources", async () => {
  const { apply, state, commit, preview, host } = setup();
  const [source, unselected] = state.entities;
  const response = await apply();
  expect(response).toMatchObject({
    ok: true,
    result: { entityId: target.id, cleanupPending: false },
  });
  expect(commit).toHaveBeenCalledOnce();
  expect(state.history).toHaveLength(1);
  expect(state.history[0].entities[0]).toBe(source);
  expect(source.constructionOrderKey).toBeUndefined();
  expect(state.entities[0].locked).toBe(true);
  expect(state.entities[0].positions).toBe(source.positions);
  expect(state.entities[0]).toBe(source);
  expect(state.entities[0].constructionOrderKey).toBeUndefined();
  expect(preview.definition.sources).toHaveLength(1);
  expect(response).toMatchObject({ result: { assignedSources: [] } });
  expect(state.entities[1]).toBe(unselected);
  expect(unselected.constructionOrderKey).toBeUndefined();
  const created = state.entities[2];
  expect(created.kind).toBe("referencePoint");
  expect(created.positions.length).toBe(0);
  expect(created.reference?.geometry).toEqual(preview.preview.geometry);
  expect(created.reference?.definition.sources).toEqual([]);
  const geometry = created.reference!.geometry;
  if (geometry.kind !== "point") throw Error("Expected point");
  expect(Object.is(geometry.position[0], -0)).toBe(true);
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: false,
    reason: "applied",
  });
});
it("removes old accepted links when an existing derived point becomes numeric", async () => {
  const source = { ...mesh("source"), constructionOrderKey: "02".repeat(16) };
  const original = referencePoint();
  original.reference!.definition = {
    version: 1,
    kind: "point",
    mode: "center",
    sources: [
      { id: source.id, constructionOrderKey: source.constructionOrderKey },
    ],
  };
  const f = setup([original, source], {
    definition: {
      version: 1,
      kind: "point",
      mode: "coordinates",
      position: [1, 2, 3],
      sources: original.reference!.definition.sources,
    },
  });
  f.setTarget({ kind: "edit", id: original.id });
  expect((await f.apply()).ok).toBe(true);
  expect(
    datumEntityDependencies(f.state.entities).find(
      (row) => row.id === original.id,
    )?.references,
  ).toEqual([]);
  expect(
    f.state.history[0].entities[0].reference!.definition.sources,
  ).toHaveLength(1);
  expect(f.state.entities[1]).toBe(source);
});
it("finalizes numeric point state without recomputing its cached geometry", async () => {
  const f = setup(undefined, {
    evaluationAllowed: false,
    prior: {
      geometry: { kind: "point", position: [7, 8, 9] },
      state: { completionWord: 0x324 },
    },
  });
  expect(f.preview.preview.state.completionWord).toBe(0x324);
  expect((await f.apply()).ok).toBe(true);
  expect(f.state.entities[2].reference!.geometry).toEqual(
    f.preview.preview.geometry,
  );
  expect(f.state.entities[2].reference!.evaluation.completionWord).toBe(0x100);
});
it("clears numeric line dependencies but retains ordered inactive picks and cached geometry", async () => {
  const entities = [mesh("locked-source", true)];
  const sources = resolveConstructionIdentities(entities, [
    entities[0].id,
  ]).orderedSources;
  const records = [0, 1].map(() => ({
    entityId: entities[0].id,
    storage: "native-pick-record-f32" as const,
    coordinates: [-0, 2, 3] as const,
  }));
  const f = setup(entities, {
    definition: {
      version: 1,
      kind: "line",
      mode: "endpoints",
      start: [1, 2, 3],
      end: [4, 6, 3],
      sources,
      records,
    },
    evaluationAllowed: false,
    prior: {
      geometry: {
        kind: "line",
        start: [0, 0, 0],
        direction: [1, 0, 0],
        length: 10,
      },
      state: { completionWord: 0x324 },
    },
  });
  expect((await f.apply()).ok).toBe(true);
  const data = f.state.entities[1].reference!;
  expect(data.definition.sources).toEqual([]);
  if (data.definition.kind !== "line") throw Error("Expected line");
  expect(data.definition.records).toEqual(records);
  expect(Object.is(data.definition.records[0].coordinates[0], -0)).toBe(true);
  expect(data.geometry).toEqual(f.preview.preview.geometry);
  expect(data.evaluation.completionWord).toBe(0x100);
  expect(f.state.entities[0]).toBe(entities[0]);
  expect(entities[0].constructionOrderKey).toBeUndefined();
  expect(f.preview.definition.sources).toHaveLength(1);
});
it("returns the exact retry receipt without publishing twice", async () => {
  const { api, args, commit } = setup();
  const request = args();
  const first = await api.invoke("object_update", request);
  expect(first.ok).toBe(true);
  expect(await api.invoke("object_update", request)).toEqual(first);
  expect(commit).toHaveBeenCalledOnce();
});
it("keeps a failed commit preview available for a fresh retry", async () => {
  const { apply, commit, state, host } = setup();
  commit.mockImplementationOnce(() => {
    throw Error("Commit rejected");
  });
  expect(await apply()).toMatchObject({ ok: false });
  expect(state.history).toHaveLength(0);
  expect(inspectReferenceConstructionPreview(host).active).toBe(true);
  expect((await apply()).ok).toBe(true);
  expect(state.history).toHaveLength(1);
});
it("reports cleanup failure as a successful committed result without a second commit", async () => {
  const { apply, clear, commit, host, preview } = setup();
  clear.mockImplementationOnce(() => {
    throw Error("GPU cleanup");
  });
  expect(await apply()).toMatchObject({
    ok: true,
    result: { cleanupPending: true },
  });
  expect(commit).toHaveBeenCalledOnce();
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: false,
    cleanupPending: true,
  });
  releaseReferenceConstructionPreview(host, preview.sessionId);
  expect(commit).toHaveBeenCalledOnce();
});
it("rejects stale model state before mutation", async () => {
  const { apply, state, commit } = setup();
  state.name = "Changed";
  expect((await apply()).ok).toBe(false);
  expect(commit).not.toHaveBeenCalled();
});
it("rejects expiry before mutation", async () => {
  const { apply, commit } = setup();
  vi.advanceTimersByTime(60000);
  expect((await apply()).ok).toBe(false);
  expect(commit).not.toHaveBeenCalled();
});
it("rejects a duplicate destination without consuming the preview", async () => {
  const { apply, setTarget, commit, host } = setup();
  setTarget({ ...target, id: "unselected" });
  expect((await apply()).ok).toBe(false);
  expect(commit).not.toHaveBeenCalled();
  expect(inspectReferenceConstructionPreview(host).active).toBe(true);
});
it("allows only the exact missing deterministic key on a locked source", () => {
  const source = mesh("source", true);
  const assignments = resolveConstructionIdentities(
    [source],
    ["source"],
  ).assignments;
  const next = {
    ...source,
    constructionOrderKey: assignments[0].constructionOrderKey,
  };
  expect(lockedObjectEdit([source], [next])).toBe(source);
  expect(
    lockedObjectEdit([source], [next], {
      constructionIdentityMigration: assignments,
    }),
  ).toBeUndefined();
  expect(() =>
    lockedObjectEdit(
      [source],
      [{ ...next, positions: source.positions.slice() }],
      { constructionIdentityMigration: assignments },
    ),
  ).toThrow();
  expect(() =>
    lockedObjectEdit([source], [{ ...next, name: "Changed" }], {
      constructionIdentityMigration: assignments,
    }),
  ).toThrow();
});
it("rejects arbitrary key changes and key replacement even with a migration policy", () => {
  const source = mesh("source", true);
  const wrong = { id: source.id, constructionOrderKey: "00".repeat(16) };
  expect(() =>
    lockedObjectEdit([source], [{ ...source, ...wrong }], {
      constructionIdentityMigration: [wrong],
    }),
  ).toThrow();
  const assignment = resolveConstructionIdentities([source], ["source"])
    .assignments[0];
  const keyed = {
    ...source,
    constructionOrderKey: assignment.constructionOrderKey,
  };
  expect(() =>
    lockedObjectEdit([keyed], [keyed], {
      constructionIdentityMigration: [assignment],
    }),
  ).toThrow();
});
it("does not allow migrating a deleted source or duplicate policy identities", () => {
  const source = mesh("source", true);
  const assignment = resolveConstructionIdentities([source], ["source"])
    .assignments[0];
  const next = {
    ...source,
    constructionOrderKey: assignment.constructionOrderKey,
  };
  expect(() =>
    lockedObjectEdit([source], [], {
      constructionIdentityMigration: [assignment],
    }),
  ).toThrow();
  expect(() =>
    lockedObjectEdit([source], [next], {
      constructionIdentityMigration: [assignment, assignment],
    }),
  ).toThrow();
});
it("edits an unlocked numeric reference while retaining its identity and display metadata", async () => {
  const original = referencePoint();
  const f = setup([original]);
  f.setTarget({ kind: "edit", id: original.id });
  expect((await f.apply()).ok).toBe(true);
  expect(f.state.entities).toHaveLength(1);
  expect(f.state.history).toHaveLength(1);
  expect(f.state.history[0].entities[0]).toBe(original);
  expect(f.state.entities[0]).toMatchObject({
    id: original.id,
    constructionOrderKey: original.constructionOrderKey,
    color: original.color,
    name: original.name,
  });
  expect(f.state.entities[0].reference?.geometry).toEqual(
    f.preview.preview.geometry,
  );
});
it("rejects a locked reference target without consuming the preview", async () => {
  const original = referencePoint(true);
  const f = setup([original]);
  f.setTarget({ kind: "edit", id: original.id });
  expect((await f.apply()).ok).toBe(false);
  expect(f.commit).not.toHaveBeenCalled();
  expect(inspectReferenceConstructionPreview(f.host).active).toBe(true);
});
it("rejects editing an ordinary object as a semantic reference", async () => {
  const f = setup([mesh("ordinary")]);
  f.setTarget({ kind: "edit", id: "ordinary" });
  expect((await f.apply()).ok).toBe(false);
  expect(f.commit).not.toHaveBeenCalled();
});
it("rejects edits whose dependent references cannot yet be rebuilt", async () => {
  const original = referencePoint();
  const dependent: Entity = {
    ...referencePoint(),
    id: "dependent",
    constructionOrderKey: "22".repeat(16),
    reference: {
      ...original.reference!,
      definition: {
        version: 1,
        kind: "point",
        mode: "coordinates",
        position: [5, 5, 5],
        sources: [
          {
            id: original.id,
            constructionOrderKey: original.constructionOrderKey!,
          },
        ],
      },
    },
  };
  const f = setup([original, dependent]);
  f.setTarget({ kind: "edit", id: original.id });
  expect((await f.apply()).ok).toBe(false);
  expect(f.commit).not.toHaveBeenCalled();
});
it("publishes the cached finite line rather than rebuilding its endpoints on Apply", async () => {
  const f = setup([], {
    definition: {
      version: 1,
      kind: "line",
      mode: "endpoints",
      start: [1, 2, 3],
      end: [4, 6, 3],
      sources: [],
      records: [],
    },
    prior: {
      geometry: {
        kind: "line",
        start: [0, 0, 0],
        direction: [1, 0, 0],
        length: 1,
      },
      state: { completionWord: 0 },
    },
  });
  expect((await f.apply()).ok).toBe(true);
  expect(f.state.entities[0].kind).toBe("referenceLine");
  expect(f.state.entities[0].reference?.geometry).toEqual(
    f.preview.preview.geometry,
  );
  expect(f.state.entities[0].reference?.evaluation).toEqual(
    f.preview.preview.state,
  );
});
it("keeps derived-mode publication unavailable until its source finalization is implemented", async () => {
  const f = setup([], {
    definition: { version: 1, kind: "point", mode: "center", sources: [] },
    evaluationAllowed: false,
  });
  expect(await f.apply()).toMatchObject({
    ok: false,
    error: {
      message:
        "Derived reference acceptance requires source-specific finalization.",
    },
  });
  expect(f.commit).not.toHaveBeenCalled();
  expect(inspectReferenceConstructionPreview(f.host).active).toBe(true);
});
it("rejects a cached source key that does not match the current deterministic identity", async () => {
  const f = setup(undefined, {
    definition: {
      version: 1,
      kind: "point",
      mode: "coordinates",
      position: [1, 2, 3],
      sources: [{ id: "locked-source", constructionOrderKey: "00".repeat(16) }],
    },
  });
  expect((await f.apply()).ok).toBe(false);
  expect(f.commit).not.toHaveBeenCalled();
  expect(f.state.entities[0].constructionOrderKey).toBeUndefined();
});
it("rejects a changed session version without changing history", async () => {
  const f = setup();
  f.setVersion(f.preview.version + 1);
  expect((await f.apply()).ok).toBe(false);
  expect(f.commit).not.toHaveBeenCalled();
  expect(inspectReferenceConstructionPreview(f.host).active).toBe(true);
});
