// Shared recipe-source contract; native fitter numerical equivalence is separate.
import { afterEach, expect, it, vi } from "vitest";
import nativeConeOracle from "./fixtures/alignment-datum-cone-native.json";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import {
  createOperations,
  rebuildCadFeature,
} from "../src/automation/operations";
import type { CadClient } from "../src/cad/client";
import type {
  Entity,
  KernelMesh,
  KernelPrimitive,
  Project,
  Vec3,
} from "../src/types";
import {
  resolveReferenceLineSource,
  resolveReferencePointSource,
} from "../src/reference-construction-resolver";
import {
  assertReferenceWorkspaceAdmission,
  encodeReferenceEntityData,
} from "../src/reference-entity";
import { lockedObjectEdit } from "../src/object-operations";
import { serializeProject, parseProject } from "../src/io";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
  type ProjectSession,
} from "../src/project-file-codec";
import {
  createNumericDatumPlane,
  numericDatumFrame,
} from "../src/datum-construction";

const apis: ApplicationApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
  vi.restoreAllMocks();
});
const key = (n: number) => n.toString(16).padStart(32, "0");
const triangle = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const sphere = (center: Vec3 = [0, 0, 0]): KernelPrimitive => ({
  kind: "sphere",
  center,
  radius: 2,
});
const cylinder = (center: Vec3 = [0, 0, 0]): KernelPrimitive => ({
  kind: "cylinder",
  center,
  axis: [0, 0, 2],
  radius: 2,
  height: 8,
});
function primitive(id: string, order: number, input: KernelPrimitive): Entity {
  return {
    id,
    name: id,
    kind: "cad",
    positions: [...triangle],
    kernelId: `old-${id}`,
    brep: `mock-${id}`,
    color: "#ffffff",
    visible: true,
    opacity: 1,
    constructionOrderKey: key(order),
    parametric: {
      output: 0,
      feature: {
        id: `feature-${id}`,
        name: id,
        recipe: { kind: "primitive", input },
      },
    },
  };
}
function point(id: string, order: number, position: Vec3): Entity {
  return {
    id,
    name: id,
    kind: "referencePoint",
    positions: [],
    constructionOrderKey: key(order),
    color: "#ffffff",
    opacity: 1,
    visible: true,
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "point",
        mode: "coordinates",
        sources: [],
        position,
      },
      geometry: { kind: "point", position },
      evaluation: { completionWord: 256 },
    },
  };
}
const bind = (e: Entity) => ({
  id: e.id,
  constructionOrderKey: e.constructionOrderKey!,
});
function chain() {
  const source = primitive("source", 1, sphere()),
    anchor = point("anchor", 2, [10, 0, 0]);
  const center = point("center", 3, [0, 0, 0]);
  center.reference!.definition = {
    version: 1,
    kind: "point",
    mode: "center",
    sources: [bind(source)],
  };
  const joined: Entity = {
    id: "joined",
    name: "joined",
    kind: "referenceLine",
    positions: [],
    constructionOrderKey: key(4),
    color: "#ffffff",
    visible: true,
    opacity: 1,
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "line",
        mode: "pair",
        sources: [bind(anchor), bind(center)],
        records: [center, anchor].map((e) => ({
          entityId: e.id,
          storage: "native-pick-record-f32",
          coordinates: e.id === "center" ? [-0, 2 ** -149, -0] : [10, 0, 0],
        })),
      },
      geometry: {
        kind: "line",
        start: [0, 0, 0],
        direction: [1, 0, 0],
        length: 10,
      },
      evaluation: { completionWord: 256 },
    },
  };
  const last = point("last", 5, [5, 0, 0]);
  last.reference!.definition = {
    version: 1,
    kind: "point",
    mode: "center",
    sources: [bind(joined)],
  };
  return {
    source,
    anchor,
    center,
    joined,
    last,
    entities: [last, joined, center, anchor, source],
  };
}
function setup(
  entities: Entity[] = [
    primitive("sphere", 1, sphere([2, 0, 0])),
    primitive("cylinder", 2, cylinder([0, 4, 0])),
    point("point", 3, [10, 0, 0]),
  ],
) {
  const state: WorkspaceSnapshot = {
    name: "Recipe source contract",
    entities,
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: null,
    selection: null,
  };
  let sequence = 0;
  const mesh = (): KernelMesh => ({
    kernelId: `new-${++sequence}`,
    positions: [...triangle],
    brep: `mock-brep-${sequence}`,
  });
  const create = vi.fn<CadClient["primitive"]>(async () => mesh());
  const transform = vi.fn<CadClient["transform"]>(async () => mesh());
  const release = vi.fn<CadClient["release"]>(async () => {});
  const backend: Pick<CadClient, "primitive" | "transform" | "release"> = {
    primitive: create,
    transform,
    release,
  };
  const commit = vi.fn<WorkspaceHost["commit"]>((next, label, policy) => {
    if (lockedObjectEdit(state.entities, next, policy))
      throw Error("Locked geometry edit");
    state.history.push({ label, entities: state.entities });
    state.entities = next;
    state.future = [];
  });
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => backend as CadClient,
    commit,
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
    showReferenceConstructionPreview: vi.fn(),
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
  return { state, host, api, command, create, transform, release, commit };
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
async function finish(h: Harness, admission: any) {
  if (!admission.jobId) return { status: "succeeded", result: admission };
  for (let i = 0; i < 100; i++) {
    const job = await value(
      h.api.invoke("job_get", { jobId: admission.jobId }),
    );
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw Error("Mock application job did not settle");
}
const find = (h: Harness, id: string) =>
  h.state.entities.find((e) => e.id === id)!;
async function preview(h: Harness, args: Record<string, unknown>) {
  return value(
    h.command("reference_construct", { action: "preview", ...args }),
  );
}
async function accept(h: Harness, p: any) {
  return value(
    h.command("reference_construct", {
      action: "apply",
      sessionId: p.sessionId,
      version: p.version,
    }),
  );
}
async function linePreview(
  h: Harness,
  mode: "pair" | "average",
  sourcePicks: unknown[],
) {
  const prior = await preview(h, {
    kind: "line",
    start: [0, 0, -3],
    end: [0, 0, 3],
  });
  return preview(h, {
    kind: "line",
    mode,
    sourcePicks,
    sessionId: prior.sessionId,
    version: prior.version,
  });
}
function project(entities: Entity[]): Project {
  return {
    format: "maliev-scanforge",
    version: 1,
    units: "mm",
    name: "Recipe sources",
    entities,
  };
}
const session = (entities: Entity[]): ProjectSession => ({
  project: project(entities),
  history: [{ label: "Before", entities: structuredClone(entities) }],
  future: [{ label: "After", entities: structuredClone(entities) }],
});

it.each(["sphere", "cylinder"] as const)(
  "resolves %s from its current recipe in the actual default point/line resolver",
  (kind) => {
    const source = primitive(
      "source",
      1,
      kind === "sphere" ? sphere([1, 2, 3]) : cylinder([1, 2, 3]),
    );
    const expected =
      kind === "sphere"
        ? { kind: "point", position: [1, 2, 3] }
        : { kind: "axis", start: [1, 2, -1], end: [1, 2, 7] };
    expect(resolveReferencePointSource(source)).toMatchObject(expected);
    expect(resolveReferenceLineSource(source, "pair")).toMatchObject(expected);
    if (kind === "cylinder")
      expect(resolveReferenceLineSource(source, "average")).toMatchObject(
        expected,
      );
    else
      expect(() => resolveReferenceLineSource(source, "average")).toThrow(
        /average|axis|line/i,
      );
  },
);

it("queries exactly the same recipe-source eligibility used by Preview, without publishing keys", async () => {
  const h = setup(),
    before = structuredClone(h.state.entities),
    revision = h.api.currentRevision();
  for (const [kind, mode] of [
    ["point", "center"],
    ["point", "pair"],
    ["line", "pair"],
    ["line", "average"],
  ]) {
    const page = await value(
      h.api.invoke("reference_construction_sources", {
        kind,
        mode,
        limit: 100,
      }),
    );
    const rows = new Map(page.sources.map((row: any) => [row.entityId, row]));
    expect(rows.get("cylinder")).toMatchObject({
      eligible: true,
      primitiveKind: "axis",
    });
    expect(rows.get("sphere")).toMatchObject({
      eligible: kind !== "line" || mode !== "average",
    });
  }
  expect(h.state.entities).toEqual(before);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.commit).not.toHaveBeenCalled();
});

it.each(["sphere", "cylinder"] as const)(
  "previews/applies recipe %s center through the shared public command",
  async (sourceId) => {
    const h = setup(),
      p = await preview(h, {
        kind: "point",
        mode: "center",
        sourceEntityIds: [sourceId],
      });
    expect(p.geometry.position).toEqual(
      sourceId === "sphere" ? [2, 0, 0] : [0, 4, 0],
    );
    const result = await accept(h, p),
      accepted = find(h, result.entityId);
    expect(accepted.reference!.definition.sources.map((row) => row.id)).toEqual(
      [sourceId],
    );
    expect(encodeReferenceEntityData(accepted.reference!).geometry).toEqual(
      p.geometryEncoding,
    );
    expect(h.state.history).toHaveLength(1);
  },
);

it("uses sphere center and finite cylinder axis in a public point pair", async () => {
  const h = setup(),
    p = await preview(h, {
      kind: "point",
      mode: "pair",
      sourceEntityIds: ["sphere", "cylinder"],
    });
  expect(p.geometry.position).toEqual([0, 4, 0]);
  const accepted = await accept(h, p);
  expect(find(h, accepted.entityId).reference!.definition.sources).toHaveLength(
    2,
  );
});

it("uses source locations once for line pair while retaining F32 suffixes and canonical recipe dependencies", async () => {
  const h = setup(),
    p = await linePreview(h, "pair", [
      { entityId: "cylinder", parameter: 0.125 },
      { entityId: "sphere" },
    ]);
  expect(p.definition.records.map((r: any) => r.entityId)).toEqual([
    "cylinder",
    "sphere",
  ]);
  expect(p.definition.sources.map((r: any) => r.id)).toEqual([
    "sphere",
    "cylinder",
  ]);
  expect(p.definition.records[0].coordinates).toEqual([0, 4, -3]);
  const made = await accept(h, p);
  expect(find(h, made.entityId).reference!.definition).toEqual(p.definition);
});

it("averages two recipe cylinders with repeated weighting and an actual owned prior", async () => {
  const h = setup([
    primitive("a", 1, cylinder([0, 2, 0])),
    primitive("b", 2, cylinder([0, 8, 0])),
  ]);
  const p = await linePreview(h, "average", [
    { entityId: "a", parameter: 0.25 },
    { entityId: "b", parameter: 0.75 },
    { entityId: "a", parameter: 0.5 },
  ]);
  expect(p.geometry.start).toEqual([0, 4, -3]);
  expect(p.geometry.length).toBe(6);
  expect(p.diagnostics.contributingRecords).toBe(3);
  const made = await accept(h, p);
  expect(
    encodeReferenceEntityData(find(h, made.entityId).reference!).geometry,
  ).toEqual(p.geometryEncoding);
});

it.each(["sphere", "cylinder"] as const)(
  "consumes an actually accepted primitive_fit_create %s recipe rather than a hand-authored fit mapping",
  async (kind) => {
    const positions =
      kind === "sphere"
        ? [
            [2, 0, 0],
            [-2, 0, 0],
            [0, 2, 0],
            [0, -2, 0],
            [0, 0, 2],
            [0, 0, -2],
          ].flat()
        : [-4, 0, 4].flatMap((z) =>
            Array.from({ length: 8 }, (_, i) => [
              2 * Math.cos((i * Math.PI) / 4),
              2 * Math.sin((i * Math.PI) / 4),
              z,
            ]).flat(),
          );
    const scan: Entity = {
      id: "scan",
      name: "Analytic samples",
      kind: "pointcloud",
      positions,
      color: "#ffffff",
      opacity: 1,
      visible: true,
    };
    const h = setup([scan]),
      original = scan.positions;
    const job = await finish(
      h,
      await value(
        h.command("primitive_fit_create", {
          entityId: scan.id,
          kind,
          selectionOnly: false,
        }),
      ),
    );
    expect(job.status, JSON.stringify(job)).toBe("succeeded");
    const source = find(h, job.result.entityId),
      recipe = source.parametric!.feature.recipe;
    expect(recipe.kind).toBe("primitive");
    if (recipe.kind !== "primitive")
      throw Error("Expected actual fitted primitive recipe");
    expect(recipe.input.kind).toBe(kind);
    expect(source.fit!.kind).toBe(kind);
    expect(h.create).toHaveBeenCalledTimes(1);
    const p = await preview(h, {
      kind: "point",
      mode: "center",
      sourceEntityIds: [source.id],
    });
    if (kind === "sphere")
      expect(p.geometry.position).toEqual(recipe.input.center);
    else
      p.geometry.position.forEach((value: number, index: number) =>
        expect(value).toBeCloseTo(recipe.input.center[index], 12),
      );
    await accept(h, p);
    expect(scan.positions).toBe(original);
    expect(h.state.history).toHaveLength(2);
  },
);

it("prefers current recipe after rebuild and never follows stale fit/display kind", () => {
  const source = primitive("source", 1, cylinder([1, 2, 3]));
  source.kind = "sphere";
  source.fit = {
    kind: "sphere",
    center: [999, 999, 999],
    axis: [0, 0, 1],
    radius: 30,
    rms: 0,
    maxError: 0,
  };
  expect(resolveReferencePointSource(source)).toMatchObject({
    kind: "axis",
    start: [1, 2, -1],
    end: [1, 2, 7],
  });
});

it("validates the current single primitive output binding before resolving recipe geometry", () => {
  const source = primitive("source", 1, sphere());
  source.parametric!.output = 1;
  expect(() => resolveReferencePointSource(source)).toThrow(
    /output|binding|primitive|invalid/i,
  );
});

it("permits identity-only migration of a locked keyless legacy recipe source at accepted Apply", async () => {
  const source = primitive("source", 1, sphere([2, 3, 4]));
  source.constructionOrderKey = undefined;
  source.locked = true;
  const h = setup([source]),
    positions = source.positions,
    parametric = source.parametric;
  const p = await preview(h, {
    kind: "point",
    mode: "center",
    sourceEntityIds: [source.id],
  });
  expect(source.constructionOrderKey).toBeUndefined();
  const made = await accept(h, p),
    migrated = find(h, source.id);
  expect(migrated.constructionOrderKey).toMatch(/^[0-9a-f]{32}$/);
  expect(migrated.locked).toBe(true);
  expect(migrated.positions).toBe(positions);
  expect(migrated.parametric).toBe(parametric);
  expect(
    find(h, made.entityId).reference!.definition.sources[0]
      .constructionOrderKey,
  ).toBe(migrated.constructionOrderKey);
});

it("refreshes a recipe cylinder -> repeated average line -> center chain without recapturing accepted locations", async () => {
  const h = setup([
    primitive("a", 1, cylinder([0, 2, 0])),
    primitive("b", 2, cylinder([0, 8, 0])),
  ]);
  const p = await linePreview(h, "average", [
    { entityId: "a", parameter: 0.25 },
    { entityId: "b", parameter: 0.75 },
    { entityId: "a", parameter: 0.5 },
  ]);
  const made = await accept(h, p),
    line = find(h, made.entityId),
    stored = encodeReferenceEntityData(line.reference!).definition;
  const center = await accept(
    h,
    await preview(h, {
      kind: "point",
      mode: "center",
      sourceEntityIds: [line.id],
    }),
  );
  const job = await finish(
    h,
    await value(
      h.command("cad_rebuild", {
        entityId: "a",
        recipe: { kind: "primitive", input: cylinder([0, 5, 0]) },
      }),
    ),
  );
  expect(job.status, JSON.stringify(job)).toBe("succeeded");
  expect(find(h, center.entityId).reference!.geometry).toEqual({
    kind: "point",
    position: [0, 6, 0],
  });
  expect(
    encodeReferenceEntityData(find(h, line.id).reference!).definition,
  ).toEqual(stored);
  expect(h.state.history).toHaveLength(3);
});

it.each(["zero-axis-cone", "box", "fit-only", "plane-line"] as const)(
  "keeps unresolved %s authority/extent outside this slice",
  async (family) => {
    const candidate =
      family === "plane-line"
        ? {
            ...createNumericDatumPlane(
              numericDatumFrame([0, 0, 5], [0, 0, 1]),
              10,
              "candidate",
              "Plane",
            ),
            constructionOrderKey: key(4),
          }
        : primitive(
            "candidate",
            4,
            family === "zero-axis-cone"
              ? {
                  kind: "cone",
                  center: [0, 0, 0],
                  axis: [0, 0, 0],
                  radius: 3,
                  topRadius: 1,
                  height: 4,
                }
              : { kind: "box", center: [0, 0, 0], size: [1, 2, 3] },
          );
    if (family === "fit-only") {
      candidate.parametric = undefined;
      candidate.kind = "mesh";
      candidate.fit = {
        kind: "sphere",
        center: [0, 0, 0],
        axis: [0, 0, 1],
        radius: 2,
        rms: 0,
        maxError: 0,
      };
    }
    const h = setup([candidate]);
    const page = await value(
      h.api.invoke("reference_construction_sources", {
        kind: "line",
        mode: "pair",
      }),
    );
    expect(page.sources[0].eligible).toBe(false);
    if (family !== "plane-line")
      expect(() => resolveReferencePointSource(candidate)).toThrow(
        /source|primitive|recipe|cone|authority|semantic/i,
      );
  },
);

it("rebuilds a cylinder through the public API while retaining an unrelated locked sphere unchanged", async () => {
  const h = setup(),
    lockedSphere = find(h, "sphere"),
    oldCylinder = find(h, "cylinder");
  lockedSphere.locked = true;
  const before = h.state.entities,
    sphereBefore = structuredClone(lockedSphere),
    binding = lockedSphere.parametric;
  const job = await finish(
    h,
    await value(
      h.command("cad_rebuild", {
        entityId: oldCylinder.id,
        recipe: { kind: "primitive", input: cylinder([0, 8, 0]) },
      }),
    ),
  );
  expect(job.status, JSON.stringify(job)).toBe("succeeded");
  expect(find(h, lockedSphere.id)).toBe(lockedSphere);
  expect(find(h, lockedSphere.id).parametric).toBe(binding);
  expect(lockedSphere).toEqual(sphereBefore);
  expect(find(h, oldCylinder.id)).not.toBe(oldCylinder);
  expect(job.result.rebuiltFeatureIds).toEqual([
    oldCylinder.parametric!.feature.id,
  ]);
  expect(job.result.refreshedEntityIds).toEqual([]);
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(h.create.mock.calls[0][0].kind).toBe("cylinder");
  expect(h.release).not.toHaveBeenCalled();
  expect(h.commit).toHaveBeenCalledTimes(1);
  expect(h.state.history).toHaveLength(1);
  expect(h.state.history[0].entities).toBe(before);
});

it("reuses the exact unchanged CAD entity and binding in the shared rebuild helper", async () => {
  const h = setup(),
    lockedSphere = find(h, "sphere"),
    oldCylinder = find(h, "cylinder"),
    before = h.state.entities;
  lockedSphere.locked = true;
  const spherePositions = lockedSphere.positions,
    sphereBinding = lockedSphere.parametric;
  const result = await rebuildCadFeature(
    h.host.cad(),
    before,
    [],
    [],
    oldCylinder.id,
    {
      kind: "primitive",
      input: cylinder([0, 8, 0]),
    },
  );
  const unchanged = result.entities.find(
    (entity) => entity.id === lockedSphere.id,
  )!;
  expect(unchanged).toBe(lockedSphere);
  expect(unchanged.positions).toBe(spherePositions);
  expect(unchanged.parametric).toBe(sphereBinding);
  expect(
    result.entities.find((entity) => entity.id === oldCylinder.id),
  ).not.toBe(oldCylinder);
  expect(result.rebuiltFeatureIds).toEqual([
    oldCylinder.parametric!.feature.id,
  ]);
  expect(lockedObjectEdit(before, result.entities)).toBeUndefined();
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toHaveLength(0);
  expect(h.commit).not.toHaveBeenCalled();
  expect(h.release).not.toHaveBeenCalled();
});

it("stages every rebuilt CAD output as a root before refreshing the full mixed reference closure", async () => {
  const c = chain();
  const child: Entity = {
    ...primitive("transformed-child", 6, sphere()),
    parametric: {
      output: 0,
      feature: {
        id: "transform-feature",
        name: "Transformed",
        recipe: {
          kind: "transform",
          source: { featureId: c.source.parametric!.feature.id },
          translation: [1, 0, 0],
          rotation: [0, 0, 0],
          scale: 1,
        },
      },
    },
  };
  const h = setup([...c.entities, child]),
    before = h.state.entities;
  const job = await finish(
    h,
    await value(
      h.command("cad_rebuild", {
        entityId: c.source.id,
        recipe: { kind: "primitive", input: sphere([4, 0, 0]) },
      }),
    ),
  );
  expect(job.status, JSON.stringify(job)).toBe("succeeded");
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(h.transform).toHaveBeenCalledTimes(1);
  expect(find(h, "last").reference!.geometry).toEqual({
    kind: "point",
    position: [7, 0, 0],
  });
  expect(job.result.refreshedEntityIds).toEqual(["center", "joined", "last"]);
  expect(
    encodeReferenceEntityData(find(h, "joined").reference!).definition,
  ).toEqual(encodeReferenceEntityData(c.joined.reference!).definition);
  expect(h.commit).toHaveBeenCalledTimes(1);
  expect(h.state.history[0].entities).toBe(before);
  expect(h.release).not.toHaveBeenCalled();
});

it("rolls back source, rebuilt CAD child, references, history and selection on a locked deep descendant and releases both new handles", async () => {
  const c = chain();
  c.last.locked = true;
  const child: Entity = {
    ...primitive("cad-child", 6, sphere()),
    parametric: {
      output: 0,
      feature: {
        id: "child-feature",
        name: "Child",
        recipe: {
          kind: "transform",
          source: { featureId: c.source.parametric!.feature.id },
          translation: [1, 0, 0],
          rotation: [0, 0, 0],
          scale: 1,
        },
      },
    },
  };
  const h = setup([...c.entities, child]);
  h.state.selectedId = c.source.id;
  const before = h.state.entities,
    revision = h.api.currentRevision();
  const job = await finish(
    h,
    await value(
      h.command("cad_rebuild", {
        entityId: c.source.id,
        recipe: { kind: "primitive", input: sphere([4, 0, 0]) },
      }),
    ),
  );
  expect(job.status).toBe("failed");
  expect(job.error.message).toMatch(/locked/i);
  expect(h.state.entities).toBe(before);
  expect(h.state.selectedId).toBe(c.source.id);
  expect(h.state.history).toHaveLength(0);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.release.mock.calls.flatMap(([ids]) => ids).sort()).toEqual([
    "new-1",
    "new-2",
  ]);
  expect(h.commit).not.toHaveBeenCalled();
});

it.each(["box", "out-of-bounds-cone-radius"] as const)(
  "rejects changing a linked recipe source to unsupported %s and releases the staged handle",
  async (kind) => {
    const c = chain(),
      h = setup(c.entities),
      before = h.state.entities;
    const input: KernelPrimitive =
      kind === "box"
        ? { kind, center: [0, 0, 0], size: [1, 2, 3] }
        : {
            kind: "cone",
            center: [0, 0, 0],
            axis: [0, 0, 1],
            radius: 1e9 + 1,
            topRadius: 1,
            height: 4,
          };
    const job = await finish(
      h,
      await value(
        h.command("cad_rebuild", {
          entityId: c.source.id,
          recipe: { kind: "primitive", input },
        }),
      ),
    );
    expect(job.status).toBe("failed");
    expect(job.error.message).toMatch(
      /source|unsupported|primitive|cone|recipe|world|bounds|radius/i,
    );
    expect(h.state.entities).toBe(before);
    expect(h.state.history).toHaveLength(0);
    expect(h.release).toHaveBeenCalledWith(["new-1"]);
    expect(h.commit).not.toHaveBeenCalled();
  },
);

it("releases staged CAD ownership when the shared history publication rejects, preserving source and reference values", async () => {
  const c = chain(),
    h = setup(c.entities),
    before = h.state.entities,
    revision = h.api.currentRevision();
  h.commit.mockImplementationOnce(() => {
    throw Error("history publication rejected");
  });
  const job = await finish(
    h,
    await value(
      h.command("cad_rebuild", {
        entityId: c.source.id,
        recipe: { kind: "primitive", input: sphere([4, 0, 0]) },
      }),
    ),
  );
  expect(job.status).toBe("failed");
  expect(job.error.message).toMatch(/publication rejected/);
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toHaveLength(0);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.release).toHaveBeenCalledWith(["new-1"]);
});

it("reports cleanup rejection without pretending a failed locked-descendant rebuild was published", async () => {
  const c = chain();
  c.last.locked = true;
  const h = setup(c.entities),
    before = h.state.entities;
  h.release.mockRejectedValueOnce(Error("staged native release rejected"));
  const job = await finish(
    h,
    await value(
      h.command("cad_rebuild", {
        entityId: c.source.id,
        recipe: { kind: "primitive", input: sphere([4, 0, 0]) },
      }),
    ),
  );
  expect(job.status).toBe("failed");
  expect(job.error.message).toMatch(/release rejected/);
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toHaveLength(0);
  expect(h.commit).not.toHaveBeenCalled();
});

it("applies the existing operation-local retained-record limit after CAD staging and cleans new native ownership on rejection", async () => {
  const source = primitive("source", 1, cylinder()),
    c = chain();
  c.joined.reference!.definition = {
    version: 1,
    kind: "line",
    mode: "average",
    sources: [bind(source)],
    records: Array.from({ length: 1001 }, () => ({
      entityId: source.id,
      storage: "native-pick-record-f32",
      coordinates: [0, 0, -0],
    })),
  };
  const h = setup([c.joined, source]),
    before = h.state.entities;
  const job = await finish(
    h,
    await value(
      h.command("cad_rebuild", {
        entityId: source.id,
        recipe: { kind: "primitive", input: cylinder([1, 2, 3]) },
      }),
    ),
  );
  expect(job.status).toBe("failed");
  expect(job.error.message).toMatch(/limit|resource|work/i);
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toHaveLength(0);
  expect(h.release).toHaveBeenCalledWith(["new-1"]);
});

it("cancels an in-flight CAD rebuild and releases the staged result without touching source or reference state", async () => {
  const c = chain(),
    h = setup(c.entities),
    before = h.state.entities;
  let finishPrimitive!: (mesh: KernelMesh) => void;
  h.create.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishPrimitive = resolve;
      }),
  );
  const admission = await value(
    h.command("cad_rebuild", {
      entityId: c.source.id,
      recipe: { kind: "primitive", input: sphere([4, 0, 0]) },
    }),
  );
  expect(typeof finishPrimitive).toBe("function");
  await value(h.api.invoke("job_cancel", { jobId: admission.jobId }));
  finishPrimitive({
    kernelId: "cancelled-new",
    positions: [...triangle],
    brep: "mock-cancelled",
  });
  const job = await finish(h, admission);
  expect(job.status).toBe("cancelled");
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toHaveLength(0);
  expect(h.release).toHaveBeenCalledWith(["cancelled-new"]);
});

it("keeps recipe-authority objects usable after JSON/binary current/history/future recovery and preserves saved reference bits", async () => {
  const c = chain(),
    input = session(c.entities);
  expect(() => assertReferenceWorkspaceAdmission(input)).not.toThrow();
  const restored = await decodeProjectContents(
    await encodeProjectFileLocally(input),
  );
  const states = [
    restored.project.entities,
    restored.history[0].entities,
    restored.future[0].entities,
  ];
  for (const rows of states) {
    expect(() =>
      assertReferenceWorkspaceAdmission({
        project: project(rows),
        history: [],
        future: [],
      }),
    ).not.toThrow();
    expect(
      encodeReferenceEntityData(
        rows.find((e) => e.id === "joined")!.reference!,
      ),
    ).toEqual(encodeReferenceEntityData(c.joined.reference!));
    expect(
      resolveReferencePointSource(rows.find((e) => e.id === "source")!),
    ).toMatchObject({ kind: "point", position: [0, 0, 0] });
  }
  const json = parseProject(serializeProject("Recovered analytic", c.entities));
  expect(
    encodeReferenceEntityData(
      json.entities.find((e) => e.id === "joined")!.reference!,
    ),
  ).toEqual(encodeReferenceEntityData(c.joined.reference!));
});

it.each(["current", "history", "future"] as const)(
  "rejects a rebound recipe source key in %s recovery without rewriting retained data",
  (slot) => {
    const input = session(chain().entities),
      rows =
        slot === "current"
          ? input.project.entities
          : slot === "history"
            ? input.history[0].entities
            : input.future[0].entities;
    rows.find((e) => e.id === "source")!.constructionOrderKey = key(99);
    const before = structuredClone(input);
    expect(() => assertReferenceWorkspaceAdmission(input)).toThrow(
      /identity|binding|source/i,
    );
    expect(input).toEqual(before);
  },
);

it("records one CAD+reference history transaction and restores exact source/derived values through undo/redo", async () => {
  const c = chain(),
    h = setup(c.entities),
    before = h.state.entities;
  const job = await finish(
    h,
    await value(
      h.command("cad_rebuild", {
        entityId: c.source.id,
        recipe: { kind: "primitive", input: sphere([4, 0, 0]) },
      }),
    ),
  );
  expect(job.status, JSON.stringify(job)).toBe("succeeded");
  const after = h.state.entities;
  expect(find(h, "last").reference!.geometry).toEqual({
    kind: "point",
    position: [7, 0, 0],
  });
  await value(h.command("history_undo", {}));
  expect(h.state.entities).toBe(before);
  await value(h.command("history_redo", {}));
  expect(h.state.entities).toBe(after);
});

it("invalidates an owned recipe-source Preview when a source rebuild commits, rather than applying cached old geometry", async () => {
  const h = setup(),
    p = await preview(h, {
      kind: "point",
      mode: "center",
      sourceEntityIds: ["sphere"],
    });
  const job = await finish(
    h,
    await value(
      h.command("cad_rebuild", {
        entityId: "sphere",
        recipe: { kind: "primitive", input: sphere([8, 0, 0]) },
      }),
    ),
  );
  expect(job.status, JSON.stringify(job)).toBe("succeeded");
  expect(
    await h.command("reference_construct", {
      action: "apply",
      sessionId: p.sessionId,
      version: p.version,
    }),
  ).toMatchObject({ ok: false });
  expect(h.state.entities).toHaveLength(3);
  expect(h.state.history).toHaveLength(1);
});

// Positive current-recipe cone admission. Original geometry oracle and whole
// native construction/GUI lifecycle are separate gates; no native objects here.
const coneRecipe = (
  center: Vec3 = [10, 20, 30],
): Extract<KernelPrimitive, { kind: "cone" }> => ({
  kind: "cone",
  center,
  axis: [0, 0, 2],
  radius: 4,
  topRadius: 2,
  height: 8,
});

it.each([2, 4, 6])(
  "resolves oblique nonunit cone axes for top radius %s within application geometry tolerance",
  (topRadius) => {
    const input = { ...coneRecipe(), axis: [2, 3, 4] as Vec3, topRadius };
    const source = primitive("cone", 1, input);
    const axis = resolveReferenceLineSource(source, "pair");
    expect(axis.kind).toBe("axis");
    if (axis.kind !== "axis") throw Error("Missing cone axis");
    const length = Math.hypot(...input.axis),
      sign = topRadius < input.radius ? 1 : -1;
    for (let coordinate = 0; coordinate < 3; coordinate++) {
      const half = ((input.axis[coordinate] / length) * input.height) / 2;
      expect(axis.start[coordinate]).toBeCloseTo(
        input.center[coordinate] + sign * half,
        12,
      );
      expect(axis.end[coordinate]).toBeCloseTo(
        input.center[coordinate] - sign * half,
        12,
      );
    }
  },
);

it("admits nearly cylindrical finite endpoints even when the internal canonical apex exceeds world bounds", () => {
  const source = primitive("cone", 1, {
    ...coneRecipe([0, 0, 0]),
    topRadius: 4 - 2 ** -30,
  });
  expect(resolveReferenceLineSource(source, "pair")).toMatchObject({
    kind: "axis",
    start: [0, 0, 4],
    end: [0, 0, -4],
  });
});

it.each([0, 2])(
  "resolves a cone with top radius %s to the native small-to-large finite axis",
  (topRadius) => {
    const source = primitive("cone", 1, { ...coneRecipe(), topRadius });
    const before = structuredClone(source);
    const axis = { kind: "axis", start: [10, 20, 34], end: [10, 20, 26] };
    expect(resolveReferencePointSource(source)).toMatchObject(axis);
    expect(resolveReferenceLineSource(source, "pair")).toMatchObject(axis);
    expect(resolveReferenceLineSource(source, "average")).toMatchObject(axis);
    expect(source).toEqual(before);
  },
);

it.each([0, 2, 4, 6])(
  "exposes cone top radius %s consistently in point and line discovery without assigning keys",
  async (topRadius) => {
    const source = primitive("cone", 1, { ...coneRecipe(), topRadius });
    source.constructionOrderKey = undefined;
    const h = setup([source]),
      before = h.state.entities,
      revision = h.api.currentRevision();
    for (const [kind, mode] of [
      ["point", "center"],
      ["point", "pair"],
      ["line", "pair"],
      ["line", "average"],
    ]) {
      const result = await value(
        h.api.invoke("reference_construction_sources", { kind, mode }),
      );
      expect(result.sources[0]).toMatchObject({
        entityId: "cone",
        eligible: true,
        primitiveKind: "axis",
        identityStatus: "provisional",
      });
    }
    expect(h.state.entities).toBe(before);
    expect(source.constructionOrderKey).toBeUndefined();
    expect(h.api.currentRevision()).toBe(revision);
    expect(h.commit).not.toHaveBeenCalled();
  },
);

it.each([0, 2, 4, 6])(
  "uses current cone top radius %s over stale display kind and reused oracle input diagnostics",
  (topRadius) => {
    const source = primitive("cone", 1, { ...coneRecipe(), topRadius });
    source.kind = "sphere";
    // Reuse the existing original-probe's declared input; no residual is invented.
    // This stale diagnostic record is deliberately unrelated to the current recipe.
    source.fit = structuredClone(
      nativeConeOracle.cases[0].fit,
    ) as Entity["fit"];
    const before = structuredClone(source);
    const axis = {
      kind: "axis",
      start: [10, 20, topRadius < 4 ? 34 : 26],
      end: [10, 20, topRadius < 4 ? 26 : 34],
    };
    expect(resolveReferencePointSource(source)).toMatchObject(axis);
    expect(resolveReferenceLineSource(source, "average")).toMatchObject(axis);
    expect(source).toEqual(before);
  },
);

it.each([0, 2, 4, 6])(
  "constructs cone top radius %s center at its finite-axis midpoint and uses the same axis in a point pair",
  async (topRadius) => {
    const source = primitive("cone", 1, { ...coneRecipe(), topRadius }),
      anchor = point("anchor", 2, [16, 20, 30]);
    const h = setup([source, anchor]);
    const center = await preview(h, {
      kind: "point",
      mode: "center",
      sourceEntityIds: [source.id],
    });
    // For R4/T2 the apex is [10,20,42]; cylinder classification has no apex.
    // All application recipe branches expose the finite-axis midpoint here.
    expect(center.geometry).toEqual({ kind: "point", position: [10, 20, 30] });
    const made = await accept(h, center);
    expect(find(h, made.entityId).reference!.definition.sources).toEqual([
      bind(source),
    ]);
    const pair = await preview(h, {
      kind: "point",
      mode: "pair",
      sourceEntityIds: [anchor.id, source.id],
    });
    expect(pair.geometry).toEqual({ kind: "point", position: [10, 20, 30] });
    const joined = await accept(h, pair);
    expect(find(h, joined.entityId).reference!.definition.sources).toEqual([
      bind(source),
      bind(anchor),
    ]);
    expect(h.state.history).toHaveLength(2);
  },
);

it.each(
  [0, 2, 4, 6].flatMap((topRadius) =>
    [false, true].map((reverse) => ({ topRadius, reverse })),
  ),
)(
  "uses cone top radius $topRadius in a public line pair, reversed records=$reverse",
  async ({ topRadius, reverse }) => {
    const source = primitive("cone", 1, { ...coneRecipe(), topRadius }),
      anchor = point("anchor", 2, [16, 20, 30]);
    const h = setup([source, anchor]);
    const picks = [
      { entityId: source.id, parameter: 0.25 },
      { entityId: anchor.id },
    ];
    if (reverse) picks.reverse();
    const p = await linePreview(h, "pair", picks);
    expect(p.geometry).toMatchObject({
      kind: "line",
      start: [16, 20, 30],
      direction: [-1, 0, 0],
      length: 6,
    });
    expect(p.definition.records.map((row: any) => row.entityId)).toEqual(
      picks.map((row) => row.entityId),
    );
    expect(
      p.definition.records.find((row: any) => row.entityId === source.id)
        .coordinates,
    ).toEqual([10, 20, topRadius < 4 ? 32 : 28]);
    expect(p.definition.sources.map((row: any) => row.id)).toEqual([
      source.id,
      anchor.id,
    ]);
    const made = await accept(h, p);
    expect(
      encodeReferenceEntityData(find(h, made.entityId).reference!).geometry,
    ).toEqual(p.geometryEncoding);
  },
);

it.each(
  [0, 2, 4, 6].flatMap((topRadius) =>
    [0, 0.25, 0.5, 1].map((parameter) => ({
      topRadius,
      parameter,
      z: topRadius < 4 ? 34 - 8 * parameter : 26 + 8 * parameter,
    })),
  ),
)(
  "acquires cone top radius $topRadius fraction $parameter once with expected world Z $z",
  async ({ topRadius, parameter, z }) => {
    const h = setup([
      primitive("cone", 1, { ...coneRecipe(), topRadius }),
      point("anchor", 2, [16, 20, 30]),
    ]);
    const p = await linePreview(h, "pair", [
      { entityId: "cone", parameter },
      { entityId: "anchor" },
    ]);
    expect(p.definition.records[0].coordinates).toEqual([10, 20, z]);
    expect(p.definition.records[0].storage).toBe("native-pick-record-f32");
    expect(p.definition.records[0]).not.toHaveProperty("parameter");
    await value(
      h.command("reference_construct", {
        action: "cancel",
        sessionId: p.sessionId,
        version: p.version,
      }),
    );
    expect(h.state.entities).toHaveLength(2);
    expect(h.state.history).toHaveLength(0);
  },
);

it.each([0, 2, 4, 6])(
  "averages cone top radius %s axes with repeated record weighting and an actual owned prior",
  async (topRadius) => {
    const h = setup([
      primitive("a", 1, { ...coneRecipe([0, 2, 0]), topRadius }),
      primitive("b", 2, { ...coneRecipe([0, 8, 0]), topRadius }),
    ]);
    const p = await linePreview(h, "average", [
      { entityId: "a", parameter: 0.25 },
      { entityId: "b", parameter: 0.75 },
      { entityId: "a", parameter: 0.5 },
    ]);
    expect(p.geometry).toMatchObject({
      kind: "line",
      start: [0, 4, -3],
      length: 6,
    });
    expect(p.diagnostics.contributingRecords).toBe(3);
    expect(p.definition.records.map((row: any) => row.entityId)).toEqual([
      "a",
      "b",
      "a",
    ]);
    expect(p.definition.sources.map((row: any) => row.id)).toEqual(["a", "b"]);
    const made = await accept(h, p);
    expect(find(h, made.entityId).reference!.definition).toEqual(p.definition);
  },
);

it("uses the existing cylinder segment for equal declared cone radii without constructing an apex", () => {
  const input = { ...coneRecipe(), topRadius: 4 };
  const cone = primitive("cone", 1, input);
  const cylinderSource = primitive("cylinder", 2, {
    kind: "cylinder",
    center: input.center,
    axis: input.axis,
    radius: input.radius,
    height: input.height,
  });
  const before = structuredClone(cone);
  expect(resolveReferencePointSource(cone)).toEqual(
    resolveReferencePointSource(cylinderSource),
  );
  for (const mode of ["pair", "average"] as const)
    expect(resolveReferenceLineSource(cone, mode)).toEqual(
      resolveReferenceLineSource(cylinderSource, mode),
    );
  expect(cone).toEqual(before);
});

it("normalizes inverted cone geometry locally without rewriting its recipe, identity, axis or radii", () => {
  const source = primitive("cone", 1, { ...coneRecipe(), topRadius: 6 });
  const before = structuredClone(source);
  // Application normalization: large base M+A*H/2, reverse raw axis,
  // canonical radii 6>4. The native helper itself remains strictly R>T.
  const expected = { kind: "axis", start: [10, 20, 26], end: [10, 20, 34] };
  expect(resolveReferencePointSource(source)).toMatchObject(expected);
  expect(resolveReferenceLineSource(source, "pair")).toMatchObject(expected);
  expect(resolveReferenceLineSource(source, "average")).toMatchObject(expected);
  expect(source).toEqual(before);
});

it.each([
  "output",
  "fit-only",
  "zero-axis",
  "zero-height",
  "zero-radius",
  "negative-radius",
  "negative-top-radius",
  "oversize-top-radius",
  "world-endpoint",
] as const)(
  "rejects a cone with invalid %s authority/geometry before mutation",
  async (failure) => {
    const input = coneRecipe();
    if (failure === "zero-axis") input.axis = [0, 0, 0];
    if (failure === "zero-height") input.height = 0;
    if (failure === "zero-radius") input.radius = 0;
    if (failure === "negative-radius") input.radius = -1;
    if (failure === "negative-top-radius") input.topRadius = -1;
    if (failure === "oversize-top-radius") input.topRadius = 1e9 + 1;
    if (failure === "world-endpoint") {
      input.center = [1e9, 0, 0];
      input.axis = [1, 0, 0];
    }
    const source = primitive("cone", 1, input);
    if (failure === "output") source.parametric!.output = 1;
    if (failure === "fit-only") {
      source.parametric = undefined;
      source.fit = structuredClone(
        nativeConeOracle.cases[0].fit,
      ) as Entity["fit"];
    }
    const h = setup([source]),
      before = h.state.entities;
    expect(() => resolveReferencePointSource(source)).toThrow();
    const result = await h.command("reference_construct", {
      action: "preview",
      kind: "point",
      mode: "center",
      sourceEntityIds: [source.id],
    });
    expect(result.ok).toBe(false);
    expect(h.state.entities).toBe(before);
    expect(h.commit).not.toHaveBeenCalled();
  },
);

async function acceptedConeChain() {
  const unrelated = point("unrelated", 99, [8, 9, 10]);
  const h = setup([
    primitive("a", 1, coneRecipe([0, 2, 0])),
    primitive("b", 2, coneRecipe([0, 8, 0])),
    unrelated,
  ]);
  const p = await linePreview(h, "average", [
    { entityId: "a", parameter: 0.25 },
    { entityId: "b", parameter: 0.75 },
    { entityId: "a", parameter: 0.5 },
  ]);
  const made = await accept(h, p),
    line = find(h, made.entityId);
  const center = await accept(
    h,
    await preview(h, {
      kind: "point",
      mode: "center",
      sourceEntityIds: [line.id],
    }),
  );
  return {
    h,
    line,
    centerId: center.entityId,
    unrelated,
    stored: encodeReferenceEntityData(line.reference!).definition,
  };
}

it("rebuilds a cone recipe and the full accepted average/center DAG in one reversible history transaction", async () => {
  const { h, line, centerId, unrelated, stored } = await acceptedConeChain();
  const before = h.state.entities,
    sourceKey = find(h, "a").constructionOrderKey;
  const job = await finish(
    h,
    await value(
      h.command("cad_rebuild", {
        entityId: "a",
        recipe: {
          kind: "primitive",
          input: {
            ...coneRecipe([0, 5, 0]),
            radius: 5,
            topRadius: 1,
            height: 10,
          },
        },
      }),
    ),
  );
  expect(job.status, JSON.stringify(job)).toBe("succeeded");
  expect(find(h, centerId).reference!.geometry).toEqual({
    kind: "point",
    position: [0, 6, 0],
  });
  expect(
    encodeReferenceEntityData(find(h, line.id).reference!).definition,
  ).toEqual(stored);
  expect(find(h, unrelated.id)).toBe(unrelated);
  expect(find(h, "a").constructionOrderKey).toBe(sourceKey);
  expect(h.state.history).toHaveLength(3);
  expect(h.state.history[2].entities).toBe(before);
  expect(h.release.mock.calls.flatMap(([ids]) => ids)).not.toContain("old-a");
  const after = h.state.entities;
  await value(h.command("history_undo", {}));
  expect(h.state.entities).toBe(before);
  await value(h.command("history_redo", {}));
  expect(h.state.entities).toBe(after);
});

it.each(["locked-dependent", "invalid-radius-replacement"] as const)(
  "rejects cone rebuild %s atomically and releases its staged handle",
  async (failure) => {
    const { h, centerId, line, stored } = await acceptedConeChain();
    if (failure === "locked-dependent") find(h, centerId).locked = true;
    const before = h.state.entities,
      history = h.state.history,
      historyCount = history.length,
      future = h.state.future;
    const revision = h.api.currentRevision();
    const replacement = coneRecipe([0, 5, 0]);
    if (failure === "invalid-radius-replacement") replacement.radius = 1e9 + 1;
    const job = await finish(
      h,
      await value(
        h.command("cad_rebuild", {
          entityId: "a",
          recipe: { kind: "primitive", input: replacement },
        }),
      ),
    );
    expect(job.status).toBe("failed");
    expect(job.error.message).toMatch(
      failure === "locked-dependent"
        ? /locked/i
        : /cone|radius|apex|source|taper|world|bounds/i,
    );
    expect(h.state.entities).toBe(before);
    expect(h.state.history).toBe(history);
    expect(h.state.history).toHaveLength(historyCount);
    expect(h.state.future).toBe(future);
    expect(h.api.currentRevision()).toBe(revision);
    expect(
      encodeReferenceEntityData(find(h, line.id).reference!).definition,
    ).toEqual(stored);
    expect(h.release).toHaveBeenCalledWith(["new-1"]);
  },
);

it("preserves cone authority and accepted retained-record bits through JSON/binary recovery", async () => {
  const { h, line, stored } = await acceptedConeChain();
  const recovered = await decodeProjectContents(
    await encodeProjectFileLocally(session(h.state.entities)),
  );
  for (const rows of [
    recovered.project.entities,
    recovered.history[0].entities,
    recovered.future[0].entities,
  ]) {
    expect(() =>
      assertReferenceWorkspaceAdmission({
        project: project(rows),
        history: [],
        future: [],
      }),
    ).not.toThrow();
    expect(
      encodeReferenceEntityData(
        rows.find((row) => row.id === line.id)!.reference!,
      ).definition,
    ).toEqual(stored);
    expect(
      resolveReferenceLineSource(
        rows.find((row) => row.id === "a")!,
        "average",
      ),
    ).toMatchObject({ kind: "axis", start: [0, 2, 4], end: [0, 2, -4] });
  }
  const json = parseProject(
    serializeProject("Recovered cone sources", h.state.entities),
  );
  expect(
    encodeReferenceEntityData(
      json.entities.find((row) => row.id === line.id)!.reference!,
    ).definition,
  ).toEqual(stored);
});

it("refreshes radius-order changes without re-acquiring retained F32 suffixes or prescribing average direction", async () => {
  const { h, line, centerId, stored } = await acceptedConeChain();
  const sourceKey = find(h, "a").constructionOrderKey;
  // Positive -> equality/cylinder -> inverted -> positive. Only source a changes;
  // evaluator owns antiparallel accumulation and the accepted prior extent.
  for (const [index, topRadius] of [4, 6, 2].entries()) {
    const before = h.state.entities;
    const job = await finish(
      h,
      await value(
        h.command("cad_rebuild", {
          entityId: "a",
          recipe: {
            kind: "primitive",
            input: { ...coneRecipe([0, 5, 0]), topRadius },
          },
        }),
      ),
    );
    expect(job.status, JSON.stringify(job)).toBe("succeeded");
    expect(resolveReferenceLineSource(find(h, "a"), "average")).toMatchObject({
      kind: "axis",
      start: [0, 5, topRadius < 4 ? 4 : -4],
      end: [0, 5, topRadius < 4 ? -4 : 4],
    });
    expect(find(h, "a").constructionOrderKey).toBe(sourceKey);
    expect(
      encodeReferenceEntityData(find(h, line.id).reference!).definition,
    ).toEqual(stored);
    expect(find(h, line.id).reference!.evaluation.completionWord).toBe(256);
    expect(find(h, centerId).reference!.evaluation.completionWord).toBe(256);
    expect(h.state.history).toHaveLength(3 + index);
    const after = h.state.entities;
    await value(h.command("history_undo", {}));
    expect(h.state.entities).toBe(before);
    await value(h.command("history_redo", {}));
    expect(h.state.entities).toBe(after);
    expect(
      encodeReferenceEntityData(find(h, line.id).reference!).definition,
    ).toEqual(stored);
  }
});
