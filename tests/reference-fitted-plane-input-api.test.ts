// Shared fitted-plane point-source contract; finite line extent remains gated.
import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { createFittedPlane } from "../src/primitive-fitting";
import {
  resolveReferencePointSource,
  resolveReferenceLineSource,
} from "../src/reference-construction-resolver";
import {
  assertReferenceWorkspaceAdmission,
  encodeReferenceEntityData,
} from "../src/reference-entity";
import { lockedObjectEdit } from "../src/object-operations";
import { parseProject, serializeProject } from "../src/io";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
  type ProjectSession,
} from "../src/project-file-codec";
import type { Entity, Project, Vec3 } from "../src/types";

const apis: ApplicationApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
  vi.restoreAllMocks();
});
const key = (n: number) => n.toString(16).padStart(32, "0");
function plane(
  id = "plane",
  order = 1,
  origin: Vec3 = [0, 0, 5],
  normal: Vec3 = [0, 0, 1],
): Entity {
  return {
    ...createFittedPlane(
      { kind: "plane", center: origin, axis: normal, rms: 0, maxError: 0 },
      20,
      id,
    ),
    id,
    constructionOrderKey: key(order),
  };
}
function point(id = "point", order = 2, position: Vec3 = [2, 3, 9]): Entity {
  return {
    id,
    name: id,
    kind: "referencePoint",
    positions: [],
    color: "#ffffff",
    visible: true,
    opacity: 1,
    constructionOrderKey: key(order),
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
function setup(entities: Entity[] = [plane(), point()]) {
  const state: WorkspaceSnapshot = {
    name: "Fitted plane sources",
    entities,
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: null,
    selection: null,
  };
  const cad = vi.fn<WorkspaceHost["cad"]>(() => {
    throw Error(
      "Fitted plane creation/reference resolution must not request CAD or WASM",
    );
  });
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
  const command = (name: string, args: Record<string, unknown>) =>
    api.invoke(name, {
      ...args,
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
  return { state, host, api, command, cad, commit, display };
}
type Harness = ReturnType<typeof setup>;
async function value(
  promise: ReturnType<ApplicationApi["invoke"]>,
): Promise<any> {
  const reply = await promise;
  expect(reply.ok, JSON.stringify(reply)).toBe(true);
  if (!reply.ok) throw Error(reply.error.message);
  return reply.result;
}
async function finished(h: Harness, admission: any) {
  for (let i = 0; i < 100; i++) {
    const job = await value(
      h.api.invoke("job_get", { jobId: admission.jobId }),
    );
    if (job.status !== "running") {
      expect(job.status, JSON.stringify(job)).toBe("succeeded");
      return job.result;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw Error("Pure application fitting job did not settle");
}
const find = (h: Harness, id: string) =>
  h.state.entities.find((e) => e.id === id)!;
const preview = (h: Harness, args: Record<string, unknown>) =>
  value(h.command("reference_construct", { action: "preview", ...args }));
const accept = (h: Harness, p: any) =>
  value(
    h.command("reference_construct", {
      action: "apply",
      sessionId: p.sessionId,
      version: p.version,
    }),
  );
const cancel = (h: Harness, p: any) =>
  value(
    h.command("reference_construct", {
      action: "cancel",
      sessionId: p.sessionId,
      version: p.version,
    }),
  );
const transform = (h: Harness, extra: Record<string, unknown> = {}) =>
  h.command("mesh_transform", {
    entityId: "plane",
    translation: [0, 0, 4],
    rotation: [0, 0, 0],
    scale: 1,
    ...extra,
  });
function project(entities: Entity[]): Project {
  return {
    format: "maliev-scanforge",
    version: 1,
    units: "mm",
    name: "Fitted plane source",
    entities,
  };
}
const session = (entities: Entity[]): ProjectSession => ({
  project: project(entities),
  history: [{ label: "Before", entities: structuredClone(entities) }],
  future: [{ label: "After", entities: structuredClone(entities) }],
});
function scan(id: string, axis: number, offset: number): Entity {
  const positions = [
    [0, 0],
    [10, 0],
    [0, 10],
    [10, 10],
  ].flatMap(([a, b]) =>
    axis === 0 ? [offset, a, b] : axis === 1 ? [a, offset, b] : [a, b, offset],
  );
  return {
    id,
    name: id,
    kind: "pointcloud",
    positions,
    color: "#ffffff",
    opacity: 1,
    visible: true,
  };
}
async function fit(h: Harness, id: string) {
  return finished(
    h,
    await value(
      h.command("primitive_fit_create", {
        entityId: id,
        kind: "plane",
        selectionOnly: false,
      }),
    ),
  );
}
async function chain(h: Harness) {
  const parent = await accept(
    h,
    await preview(h, {
      kind: "point",
      mode: "pair",
      sourceEntityIds: ["plane", "point"],
    }),
  );
  const anchor = await accept(
    h,
    await preview(h, { kind: "point", position: [2, 3, 15] }),
  );
  const seed = await preview(h, {
    kind: "line",
    start: [2, 3, 5],
    end: [2, 3, 15],
  });
  const line = await accept(
    h,
    await preview(h, {
      kind: "line",
      mode: "pair",
      sourcePicks: [
        { entityId: parent.entityId },
        { entityId: anchor.entityId },
      ],
      sessionId: seed.sessionId,
      version: seed.version,
    }),
  );
  const center = await accept(
    h,
    await preview(h, {
      kind: "point",
      mode: "center",
      sourceEntityIds: [line.entityId],
    }),
  );
  return {
    parentId: parent.entityId,
    lineId: line.entityId,
    centerId: center.entityId,
  };
}

it("resolves an actual fitted plane's authoritative frame equation even when fit diagnostics disagree", () => {
  const source = plane();
  source.fit = {
    kind: "plane",
    center: [999, 999, 999],
    axis: [1, 0, 0],
    rms: 4,
    maxError: 5,
  };
  const before = structuredClone(source),
    result = resolveReferencePointSource(source);
  expect(result).toEqual({
    kind: "plane",
    origin: [0, 0, 5],
    normal: [0, 0, 1],
    offset: -5,
  });
  expect(result).not.toHaveProperty("directPlaneHalfSizes");
  expect(source).toEqual(before);
});

it("uses shared fitted-plane point eligibility for query and retains finite line sources as unsupported", async () => {
  const h = setup(),
    before = h.state.entities,
    revision = h.api.currentRevision();
  for (const mode of ["center", "pair", "threePlanes"]) {
    const page = await value(
      h.api.invoke("reference_construction_sources", { kind: "point", mode }),
    );
    expect(
      page.sources.find((row: any) => row.entityId === "plane"),
    ).toMatchObject({ eligible: true, primitiveKind: "plane" });
  }
  for (const mode of ["pair", "average"]) {
    const page = await value(
      h.api.invoke("reference_construction_sources", { kind: "line", mode }),
    );
    expect(
      page.sources.find((row: any) => row.entityId === "plane").eligible,
    ).toBe(false);
    expect(() =>
      resolveReferenceLineSource(find(h, "plane"), mode as "pair" | "average"),
    ).toThrow(/source|semantic|line|extent/i);
  }
  expect(h.state.entities).toBe(before);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.cad).not.toHaveBeenCalled();
  expect(h.commit).not.toHaveBeenCalled();
});

it("consumes primitive_fit_create plane output in public center with the existing explicit origin fallback", async () => {
  const input = scan("scan", 2, 5),
    h = setup([input]),
    positions = input.positions;
  const created = await fit(h, input.id),
    source = find(h, created.entityId);
  expect(source.kind).toBe("plane");
  expect(source.fit!.kind).toBe("plane");
  expect(source.planeFrame).toBeDefined();
  const p = await preview(h, {
    kind: "point",
    mode: "center",
    sourceEntityIds: [source.id],
  });
  expect(p).toMatchObject({
    geometry: { kind: "point", position: [0, 0, 0] },
    outcome: "origin",
    diagnostics: { reason: "source-extraction-failed" },
  });
  const made = await accept(h, p);
  expect(find(h, made.entityId).reference!.definition.sources[0].id).toBe(
    source.id,
  );
  expect(h.state.history).toHaveLength(2);
  expect(input.positions).toBe(positions);
  expect(h.cad).not.toHaveBeenCalled();
});

it("constructs three-plane intersection from three actual fitted-plane creation operations without requesting CAD", async () => {
  const h = setup([scan("x", 0, 1), scan("y", 1, 2), scan("z", 2, 3)]),
    ids: string[] = [];
  for (const id of ["x", "y", "z"]) ids.push((await fit(h, id)).entityId);
  const p = await preview(h, {
    kind: "point",
    mode: "threePlanes",
    sourceEntityIds: ids,
  });
  expect(p.geometry).toEqual({ kind: "point", position: [1, 2, 3] });
  const made = await accept(h, p);
  expect(find(h, made.entityId).reference!.definition.sources).toHaveLength(3);
  expect(h.state.history).toHaveLength(4);
  expect(h.cad).not.toHaveBeenCalled();
});

it("transforms the fitted-plane frame through the existing shared writer and refreshes a mixed closure atomically", async () => {
  const h = setup(),
    ids = await chain(h),
    source = find(h, "plane"),
    before = h.state.entities;
  const oldPositions = source.positions,
    oldFit = source.fit;
  const records = encodeReferenceEntityData(
    find(h, ids.lineId).reference!,
  ).definition;
  const result = await value(transform(h));
  expect(result.refreshedEntityIds).toEqual([
    ids.parentId,
    ids.lineId,
    ids.centerId,
  ]);
  expect(find(h, "plane").planeFrame!.center).toEqual([0, 0, 9]);
  expect(find(h, "plane").fit).toBeUndefined();
  expect(find(h, ids.parentId).reference!.geometry).toEqual({
    kind: "point",
    position: [2, 3, 9],
  });
  expect(find(h, ids.centerId).reference!.geometry).toEqual({
    kind: "point",
    position: [2, 3, 12],
  });
  expect(
    encodeReferenceEntityData(find(h, ids.lineId).reference!).definition,
  ).toEqual(records);
  expect(source.positions).toBe(oldPositions);
  expect(source.fit).toBe(oldFit);
  expect(h.state.history.at(-1)!.entities).toBe(before);
});

it("rejects a fitted-plane transform before publication when a deep dependent is locked", async () => {
  const h = setup(),
    ids = await chain(h);
  find(h, ids.centerId).locked = true;
  const before = h.state.entities,
    history = [...h.state.history],
    revision = h.api.currentRevision(),
    source = structuredClone(find(h, "plane"));
  expect(await transform(h)).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/locked/i) },
  });
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toEqual(history);
  expect(h.api.currentRevision()).toBe(revision);
  expect(find(h, "plane")).toEqual(source);
});

it("keeps fitted diagnostic/frame/source identities unchanged through read-only query and Preview Cancel", async () => {
  const h = setup(),
    before = structuredClone(h.state.entities),
    revision = h.api.currentRevision();
  const p = await preview(h, {
    kind: "point",
    mode: "pair",
    sourceEntityIds: ["plane", "point"],
  });
  await cancel(h, p);
  expect(h.state.entities).toEqual(before);
  expect(h.state.history).toHaveLength(0);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.commit).not.toHaveBeenCalled();
});

it("migrates only a locked keyless fitted plane's source key at accepted reference Apply", async () => {
  const source = plane();
  source.constructionOrderKey = undefined;
  source.locked = true;
  const h = setup([source]),
    frame = source.planeFrame,
    positions = source.positions,
    diagnostics = source.fit;
  const p = await preview(h, {
    kind: "point",
    mode: "center",
    sourceEntityIds: [source.id],
  });
  expect(source.constructionOrderKey).toBeUndefined();
  await accept(h, p);
  const migrated = find(h, source.id);
  expect(migrated.constructionOrderKey).toMatch(/^[0-9a-f]{32}$/);
  expect(migrated.locked).toBe(true);
  expect(migrated.planeFrame).toBe(frame);
  expect(migrated.positions).toBe(positions);
  expect(migrated.fit).toBe(diagnostics);
});

it.each([
  "fit-only",
  "malformed-frame",
  "cad-kind",
  "kernel",
  "parametric",
] as const)(
  "rejects %s source authority instead of guessing an analytic plane",
  async (family) => {
    const source = plane();
    if (family === "fit-only") source.planeFrame = undefined;
    if (family === "malformed-frame")
      source.planeFrame = { ...source.planeFrame!, tangent: [0, 0, 1] };
    if (family === "cad-kind") source.kind = "cad";
    if (family === "kernel") source.kernelId = "exact-cad-plane";
    if (family === "parametric")
      source.parametric = {
        output: 0,
        feature: {
          id: "feature",
          name: "Plane-looking box",
          recipe: {
            kind: "primitive",
            input: { kind: "box", center: [0, 0, 5], size: [2, 2, 2] },
          },
        },
      };
    const h = setup([source]),
      before = h.state.entities;
    expect(() => resolveReferencePointSource(source)).toThrow(
      /plane|frame|source|primitive|semantic|bound|tangent/i,
    );
    const page = await value(
      h.api.invoke("reference_construction_sources", {
        kind: "point",
        mode: "pair",
      }),
    );
    expect(page.sources[0].eligible).toBe(false);
    expect(h.state.entities).toBe(before);
    expect(h.commit).not.toHaveBeenCalled();
  },
);

it("keeps numeric datum editing of a fitted source explicitly rejected without detaching it", async () => {
  const h = setup(),
    source = find(h, "plane"),
    before = h.state.entities;
  expect(
    await h.command("datum_construct", {
      kind: "plane",
      entityId: source.id,
      origin: [0, 0, 9],
      normal: [0, 0, 1],
      displaySize: 20,
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/numeric|fitted/i) },
  });
  expect(h.state.entities).toBe(before);
  expect(find(h, source.id)).toBe(source);
  expect(h.state.history).toHaveLength(0);
});

it("preserves accepted frame/diagnostics and derived point/pick bits in JSON/binary current/history/future", async () => {
  const h = setup(),
    ids = await chain(h),
    input = session(h.state.entities),
    expected = encodeReferenceEntityData(find(h, ids.lineId).reference!);
  expect(() => assertReferenceWorkspaceAdmission(input)).not.toThrow();
  const restored = await decodeProjectContents(
    await encodeProjectFileLocally(input),
  );
  for (const rows of [
    restored.project.entities,
    restored.history[0].entities,
    restored.future[0].entities,
  ]) {
    expect(() =>
      assertReferenceWorkspaceAdmission({
        project: project(rows),
        history: [],
        future: [],
      }),
    ).not.toThrow();
    expect(rows.find((e) => e.id === "plane")!.fit).toEqual(
      find(h, "plane").fit,
    );
    expect(rows.find((e) => e.id === "plane")!.planeFrame).toEqual(
      find(h, "plane").planeFrame,
    );
    expect(
      encodeReferenceEntityData(
        rows.find((e) => e.id === ids.lineId)!.reference!,
      ),
    ).toEqual(expected);
  }
  const json = parseProject(serializeProject("Fitted plane", h.state.entities));
  expect(
    encodeReferenceEntityData(
      json.entities.find((e) => e.id === ids.lineId)!.reference!,
    ),
  ).toEqual(expected);
});

it("restores the original fitted state and the transformed state with their reference closure in one history step", async () => {
  const h = setup(),
    ids = await chain(h),
    before = h.state.entities;
  await value(transform(h));
  const after = h.state.entities;
  await value(h.command("history_undo", {}));
  expect(h.state.entities).toBe(before);
  expect(find(h, "plane").fit).toBeDefined();
  expect(find(h, ids.centerId).reference!.geometry).toEqual({
    kind: "point",
    position: [2, 3, 10],
  });
  await value(h.command("history_redo", {}));
  expect(h.state.entities).toBe(after);
  expect(find(h, "plane").fit).toBeUndefined();
  expect(find(h, ids.centerId).reference!.geometry).toEqual({
    kind: "point",
    position: [2, 3, 12],
  });
});

it.each(["current", "history", "future"] as const)(
  "rejects a rebound fitted-plane source identity in %s without rewriting state",
  async (slot) => {
    const h = setup();
    await chain(h);
    const input = session(h.state.entities),
      rows =
        slot === "current"
          ? input.project.entities
          : slot === "history"
            ? input.history[0].entities
            : input.future[0].entities;
    rows.find((e) => e.id === "plane")!.constructionOrderKey = key(99);
    const before = structuredClone(input);
    expect(() => assertReferenceWorkspaceAdmission(input)).toThrow(
      /identity|binding|source/i,
    );
    expect(input).toEqual(before);
  },
);

it("invalidates a fitted-plane source Preview when the shared transform publishes a new frame", async () => {
  const h = setup(),
    p = await preview(h, {
      kind: "point",
      mode: "pair",
      sourceEntityIds: ["plane", "point"],
    });
  await value(transform(h));
  expect(
    await h.command("reference_construct", {
      action: "apply",
      sessionId: p.sessionId,
      version: p.version,
    }),
  ).toMatchObject({ ok: false });
  expect(h.state.entities).toHaveLength(2);
  expect(h.state.history).toHaveLength(1);
});
