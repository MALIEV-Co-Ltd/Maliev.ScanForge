import type { Entity, Project, Positions, KernelMesh } from "../types";
import { DEFAULT_PART_COLOR, DEFAULT_FREEFORM_COLOR } from "../appearance";
import { CadClient } from "../cad/client";
import type { Revision } from "../history";
import { entityFeatureState, bindFeatureInputs } from "../parametric-entities";
import {
  createCadEvaluator,
  featureDependencies,
  rebuildParametric,
  validateParametricModel,
  type ParametricRecipe,
  type ParametricFeature,
} from "../parametric";
import { duplicateObject } from "../object-operations";
import { scanMeshCopy } from "../scan-mesh-copy";
import { partitionTriangles, selectionCount } from "../selection";
import {
  meshStats,
  transformPositions,
  fitPlane,
  fitSphere,
  fitCylinder,
  fitCone,
  deviations,
  sectionMesh,
} from "../geometry";
import { processMesh, type ProcessingRequest } from "../processing-client";
import { validateSketch, solveSketch } from "../sketch";
import { validatePatch, tessellatePatch } from "../surfaces";
import { fitGridSurfaceAsync } from "../surface-client";
import { importScan } from "../import-client";
import { exportStl, validatePositions, validateProject } from "../io";
import { encodeProjectFile, decodeProjectFile } from "../project-file";
import { exportSectionDxf } from "../section-dxf";
import type {
  WorkspaceHost,
  WorkspaceSnapshot,
  Handler,
  CommandContext,
} from "./api";

const id = () => crypto.randomUUID();
function abort(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException("Operation cancelled.", "AbortError");
}
function handles(entities: Entity[]) {
  return new Set(entities.flatMap((e) => (e.kernelId ? [e.kernelId] : [])));
}
async function releaseCreated(
  cad: CadClient,
  next: Entity[],
  previous: Entity[],
) {
  const retained = handles(previous);
  const created = [...handles(next)].filter((h) => !retained.has(h));
  if (created.length) await cad.release(created);
}

/** Evaluate a validated feature against project-local dependencies, retaining previous native bodies for undo. */
export async function createCadFeature(
  cad: CadClient,
  entities: Entity[],
  recipe: ParametricRecipe,
  name: string,
  options: { hideInputs?: boolean; signal?: AbortSignal } = {},
) {
  recipe = structuredClone(recipe);
  const references = featureDependencies(recipe);
  const unknown = references.filter(
    (ref) => !entities.some((e) => e.parametric?.feature.id === ref.featureId),
  );
  for (const reference of unknown) {
    const bound = bindFeatureInputs(entities, [reference.featureId]);
    entities = bound.entities;
    Object.assign(reference, bound.refs[0]);
  }
  const previous = entityFeatureState(entities);
  const feature: ParametricFeature = {
    id: id(),
    name,
    recipe: structuredClone(recipe),
  };
  const model = {
    ...previous.model,
    features: [...previous.model.features, feature],
  };
  validateParametricModel(model);
  const rebuilt = await rebuildParametric(
    previous,
    model,
    createCadEvaluator(cad),
    { signal: options.signal, preserveKernelIds: handles(entities) },
  );
  const binding = rebuilt.model.features.find((f) => f.id === feature.id)!;
  const created: Entity[] = rebuilt.results[feature.id].map((mesh, output) => ({
    ...mesh,
    id: id(),
    name:
      rebuilt.results[feature.id].length > 1 ? `${name} ${output + 1}` : name,
    kind: "cad",
    color: DEFAULT_PART_COLOR,
    visible: true,
    opacity: 1,
    parametric: { feature: binding, output },
    surfacePatch: recipe.kind === "surface" ? recipe.patch : undefined,
  }));
  const inputIds = new Set(
    featureDependencies(recipe).map((ref) => ref.featureId),
  );
  return {
    created,
    entities: [
      ...entities.map((e) =>
        options.hideInputs &&
        e.parametric &&
        inputIds.has(e.parametric.feature.id)
          ? { ...e, visible: false }
          : e,
      ),
      ...created,
    ],
  };
}

/** Rebuild changed and dependent features while preserving all handles referenced by undo/redo. */
export async function rebuildCadFeature(
  cad: CadClient,
  entities: Entity[],
  history: Revision[],
  future: Revision[],
  entityId: string,
  recipe: ParametricRecipe,
  signal?: AbortSignal,
) {
  const selected = entities.find((e) => e.id === entityId);
  if (!selected?.parametric) throw new Error("Select a parametric CAD body.");
  if (selected.locked) throw new Error("Object is locked.");
  if (
    (recipe.kind === "split") !==
    (selected.parametric.feature.recipe.kind === "split")
  )
    throw new Error("Recipe edits must preserve their number of outputs.");
  const previous = entityFeatureState(entities);
  const featureId = selected.parametric.feature.id;
  const model = {
    ...previous.model,
    features: previous.model.features.map((f) =>
      f.id === featureId ? { ...f, recipe: structuredClone(recipe) } : f,
    ),
  };
  const dependent = new Set([featureId]);
  for (let changed = true; changed;) {
    changed = false;
    for (const feature of model.features)
      if (
        !dependent.has(feature.id) &&
        featureDependencies(feature.recipe).some((ref) =>
          dependent.has(ref.featureId),
        )
      ) {
        dependent.add(feature.id);
        changed = true;
      }
  }
  if (
    entities.some(
      (e) => e.locked && e.parametric && dependent.has(e.parametric.feature.id),
    )
  )
    throw new Error("A dependent object is locked.");
  const preserved = handles([
    ...entities,
    ...history.flatMap((r) => r.entities),
    ...future.flatMap((r) => r.entities),
  ]);
  const rebuilt = await rebuildParametric(
    previous,
    model,
    createCadEvaluator(cad),
    { signal, preserveKernelIds: preserved },
  );
  const features = new Map(rebuilt.model.features.map((f) => [f.id, f]));
  const next = entities.map((e) => {
    if (!e.parametric) return e;
    const feature = features.get(e.parametric.feature.id)!;
    const output = rebuilt.results[feature.id][e.parametric.output];
    return {
      ...e,
      ...output,
      parametric: { feature, output: e.parametric.output },
      surfacePatch:
        feature.recipe.kind === "surface" ? feature.recipe.patch : undefined,
    };
  });
  return { ...rebuilt, entities: next };
}

function object(state: WorkspaceSnapshot, entityId: string) {
  const entity = state.entities.find((e) => e.id === entityId);
  if (!entity) throw new Error(`Object ${entityId} is not in this project.`);
  return entity;
}
function editable(entity: Entity, meshOnly = false) {
  if (entity.locked) throw new Error("Object is locked.");
  if (meshOnly && (entity.kernelId || entity.parametric))
    throw new Error("Create a mesh copy before editing exact CAD geometry.");
}
function summary(e: Entity) {
  const {
    positions,
    normals: _normals,
    edgePositions: _edges,
    brep: _brep,
    kernelId: _kernel,
    meshSelection: _selection,
    ...metadata
  } = e;
  return {
    ...metadata,
    triangles: positions.length / 9,
    exactCad: !!e.kernelId,
    hasBrep: !!e.brep,
  };
}
function mask(state: WorkspaceSnapshot, e: Entity, required = true) {
  const selection = state.selectedId === e.id ? state.selection : null;
  if (!selection || selection.length !== e.positions.length / 9) {
    if (required)
      throw new Error("Select triangles on the specified object first.");
    return new Uint8Array(e.positions.length / 9);
  }
  selectionCount(selection);
  if (required && !selection.some(Boolean))
    throw new Error("Selection is empty.");
  return new Uint8Array(selection);
}
function selectedPositions(
  state: WorkspaceSnapshot,
  e: Entity,
  selectionOnly?: boolean,
): Positions {
  return selectionOnly
    ? partitionTriangles(e.positions, mask(state, e)).selected
    : e.positions;
}
function json(context: CommandContext, value: unknown, name: string) {
  context.check();
  return context.artifact(JSON.stringify(value), name, "application/json");
}
function meshEdited(e: Entity, positions: Positions): Entity {
  validatePositions(positions);
  return {
    ...e,
    positions,
    normals: undefined,
    edgePositions: undefined,
    kernelId: undefined,
    brep: undefined,
    parametric: undefined,
    fit: undefined,
    surfacePatch: undefined,
    planeFrame: undefined,
    meshSelection: undefined,
    scanSource: undefined,
    kind: "mesh",
  };
}

/** The UI and MCP call these same operation handlers; geometry always comes from the owning workspace. */
export function createOperations(host: WorkspaceHost): Record<string, Handler> {
  const commit = (c: CommandContext, entities: Entity[], label: string) => {
    c.check();
    host.commit(entities, label);
  };
  return {
    project_get: () => {
      const s = host.snapshot();
      return {
        name: s.name,
        units: "mm",
        objects: s.entities.map(summary),
        selectedId: s.selectedId,
        undo: s.history.length,
        redo: s.future.length,
        authoring: s.authoring,
        settings: s.settings,
      };
    },
    object_get: (a, c) => {
      const e = object(host.snapshot(), a.entityId);
      return {
        ...summary(e),
        ...(a.includeGeometry
          ? {
              geometry: json(
                c,
                {
                  positions: Array.from(e.positions),
                  normals: e.normals,
                  edgePositions: e.edgePositions,
                },
                "geometry.json",
              ),
            }
          : {}),
      };
    },
    object_update: (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId);
      const allowed = new Set([
        "name",
        "color",
        "opacity",
        "visible",
        "locked",
        "selectable",
      ]);
      if (Object.keys(a.patch).some((k) => !allowed.has(k)))
        throw new Error("Only display and protection metadata may be updated.");
      commit(
        c,
        s.entities.map((x) => (x.id === e.id ? { ...x, ...a.patch } : x)),
        "Update object",
      );
      return { entityId: e.id };
    },
    object_duplicate: (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId),
        copy = duplicateObject(e, id(), s.entities);
      commit(c, [...s.entities, copy], "Duplicate object");
      return { entityId: copy.id };
    },
    object_delete: (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId);
      editable(e);
      if (
        e.parametric &&
        s.entities.some(
          (x) =>
            x.parametric &&
            x.parametric.feature.id !== e.parametric!.feature.id &&
            featureDependencies(x.parametric.feature.recipe).some(
              (r) => r.featureId === e.parametric!.feature.id,
            ),
        )
      )
        throw new Error("Remove dependent features first.");
      if (e.parametric?.feature.recipe.kind === "split")
        throw new Error(
          "Delete both split outputs together through the feature workflow.",
        );
      commit(
        c,
        s.entities.filter((x) => x.id !== e.id),
        "Delete object",
      );
      return { entityId: e.id };
    },
    mesh_copy: (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId),
        copy = scanMeshCopy(e, id());
      commit(c, [...s.entities, copy], "Create mesh copy");
      return { entityId: copy.id };
    },
    cad_bind: (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId);
      editable(e);
      const bound = bindFeatureInputs(s.entities, [e.id]);
      commit(c, bound.entities, "Bind CAD feature seed");
      return { entityId: e.id, ref: bound.refs[0] };
    },
    selection_get: (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId),
        selection = mask(s, e, false);
      return {
        entityId: e.id,
        count: selectionCount(selection),
        artifact: json(
          c,
          Array.from(selection.entries())
            .filter(([, v]) => v)
            .map(([i]) => i),
          "selection.json",
        ),
      };
    },
    selection_set: (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId);
      if (e.locked || e.selectable === false)
        throw new Error("Object cannot be selected.");
      const selected = new Uint8Array(e.positions.length / 9);
      for (const triangle of a.triangles) {
        if (
          !Number.isSafeInteger(triangle) ||
          triangle < 0 ||
          triangle >= selected.length
        )
          throw new Error("Triangle index is out of bounds.");
        selected[triangle] = 1;
      }
      c.check();
      host.setSelection(e.id, selected);
      return { count: selectionCount(selected) };
    },
    selection_edit: (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId);
      editable(e, a.operation !== "copy");
      const parts = partitionTriangles(e.positions, mask(s, e));
      let next = s.entities;
      let copy: Entity | undefined;
      if (a.operation !== "delete") {
        copy = scanMeshCopy(e, id());
        copy.positions = parts.selected;
        next = [...next, copy];
      }
      if (a.operation !== "copy")
        next = parts.remainder.length
          ? next.map((x) =>
              x.id === e.id ? meshEdited(e, parts.remainder) : x,
            )
          : next.filter((x) => x.id !== e.id);
      commit(c, next, `${a.operation} selected triangles`);
      return { entityId: copy?.id, triangles: parts.selected.length / 9 };
    },
    mesh_analyze: async (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId);
      const result = await processMesh(
        {
          kind: "report",
          positions: e.positions,
          tolerance: a.tolerance ?? 1e-6,
        },
        { signal: c.signal, onProgress: c.progress },
      );
      c.check();
      return {
        stats: meshStats(e.positions),
        topology: result.topology,
        diagnostics: result.diagnostics,
      };
    },
    mesh_process: async (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId);
      const op = structuredClone(a.operation);
      const kind = op.kind as ProcessingRequest["kind"];
      const readonly =
        [
          "report",
          "connectedSelection",
          "selectionMorphology",
          "sketchSection",
          "scanPreview",
        ].includes(kind) ||
        (kind === "scanEdit" &&
          ["inventory", "boundaryProject", "boundarySmooth"].includes(
            op.action,
          ));
      if (!readonly) editable(e, true);
      if (
        "positions" in op ||
        "target" in op ||
        "selection" in op ||
        "sourceTriangleMask" in op ||
        "seeds" in op
      )
        throw new Error(
          "Geometry and selection must refer to workspace objects.",
        );
      const selection = a.selectionOnly ? mask(s, e) : undefined;
      if (
        selection &&
        !readonly &&
        !["scanEdit", "scanTools", "icp", "global"].includes(kind) &&
        !a.createNew
      )
        throw new Error(
          "Selection-only processing requires createNew:true for this operation.",
        );
      const request = {
        ...op,
        positions:
          selection &&
          !["scanEdit", "scanTools", "icp", "global"].includes(kind)
            ? partitionTriangles(e.positions, selection).selected
            : e.positions,
      } as ProcessingRequest;
      if (kind === "icp" || kind === "global") {
        if (!a.targetId) throw new Error("Alignment requires targetId.");
        Object.assign(request, {
          target: object(s, a.targetId).positions,
          sourceTriangleMask: selection,
        });
      }
      if (kind === "scanEdit")
        Object.assign(request, {
          selection,
          ...(a.targetId ? { target: object(s, a.targetId).positions } : {}),
        });
      if (kind === "connectedSelection")
        Object.assign(request, { seeds: mask(s, e) });
      if (kind === "selectionMorphology")
        Object.assign(request, {
          selection: mask(s, e),
          hidden: e.meshSelection?.hidden ?? [],
        });
      if (kind === "sketchSection")
        Object.assign(request, {
          sourceId: e.id,
          hidden: e.meshSelection?.hidden ?? [],
          selection,
          sampled: !!e.scanSource,
        });
      if (kind === "scanTools") {
        if ("targets" in op.operation || "selection" in op.operation)
          throw new Error("Inner geometry must refer to workspace objects.");
        if (op.operation.kind === "averageMesh") {
          if (!a.targetId) throw new Error("Average mesh requires targetId.");
          op.operation.targets = [object(s, a.targetId).positions];
        }
        if (op.operation.kind === "reduceNoise")
          op.operation.selection = selection;
        if (selection && op.operation.kind !== "reduceNoise")
          throw new Error("This scan tool does not support selectionOnly.");
      }
      const result = await processMesh(request, {
        signal: c.signal,
        onProgress: c.progress,
      });
      c.check();
      const edit = result.scanEdit;
      const positions = edit?.positions ?? result.positions;
      const segments = edit?.segments ?? result.segments;
      const selected = edit?.selection ?? result.selection;
      let next = s.entities;
      const created: Entity[] = [];
      if (positions) {
        const updated = meshEdited(e, positions);
        if (a.createNew) {
          updated.id = id();
          updated.name = `${e.name} ${kind}`;
          created.push(updated);
          next = [...next, updated];
        } else next = next.map((x) => (x.id === e.id ? updated : x));
      }
      if (segments?.length) {
        for (const p of segments) {
          if (!p.length) continue;
          const copy = meshEdited(scanMeshCopy(e, id()), p);
          created.push(copy);
        }
        next = [...next, ...created.filter((x) => !next.includes(x))];
      }
      const response = {
        entityIds: created.length
          ? created.map((x) => x.id)
          : positions
            ? [e.id]
            : [],
        diagnostics: result.diagnostics,
        topology: result.topology,
        registration: result.registration,
        ...(edit?.inventory || edit?.curves || result.sketchSection
          ? {
              artifact: json(
                c,
                {
                  inventory: edit?.inventory,
                  curves: edit?.curves,
                  sketchSection: result.sketchSection,
                },
                "mesh-report.json",
              ),
            }
          : {}),
      };
      c.check();
      if (positions || segments?.length) host.commit(next, `Mesh ${kind}`);
      if (selected) host.setSelection(e.id, selected);
      return response;
    },
    mesh_transform: (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId);
      editable(e, true);
      const positions = transformPositions(
        e.positions,
        a.translation,
        a.rotation,
        a.scale,
      );
      commit(
        c,
        s.entities.map((x) => (x.id === e.id ? meshEdited(e, positions) : x)),
        "Transform mesh",
      );
      return { entityId: e.id };
    },
    analysis_fit: (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId),
        p = selectedPositions(s, e, a.selectionOnly);
      c.check();
      const fitters = {
        plane: fitPlane,
        sphere: fitSphere,
        cylinder: fitCylinder,
        cone: fitCone,
      };
      const sampled: number[] = [];
      const stride = Math.max(1, Math.ceil(p.length / 3 / 20_000));
      for (let i = 0; i < p.length; i += stride * 3)
        sampled.push(p[i], p[i + 1], p[i + 2]);
      return {
        fit: fitters[a.kind as keyof typeof fitters](sampled),
        samples: sampled.length / 3,
        totalVertices: p.length / 3,
      };
    },
    analysis_section: (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId);
      if (e.positions.length > 2_250_000 && !a.selectionOnly)
        throw new Error(
          "Section analysis is limited to 250,000 triangles; select a region or reduce a mesh copy first.",
        );
      const section = sectionMesh(
        selectedPositions(s, e, a.selectionOnly),
        a.axis,
        a.offset,
      );
      const rows = ["x1,y1,z1,x2,y2,z2"];
      for (let i = 0; i < section.segments.length; i += 6)
        rows.push(section.segments.slice(i, i + 6).join(","));
      c.check();
      return {
        length: section.length,
        segments: section.segments.length / 6,
        csv: c.artifact(rows.join("\n"), "section.csv", "text/csv"),
        ...(section.segments.length
          ? {
              dxf: c.artifact(
                exportSectionDxf(section),
                "section.dxf",
                "application/dxf",
              ),
            }
          : {}),
      };
    },
    analysis_deviation: (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId);
      if (e.positions.length > 2_250_000)
        throw new Error(
          "Deviation analysis is limited to 250,000 triangles; reduce a mesh copy first.",
        );
      const fit = a.fit;
      if (
        !fit ||
        !["plane", "sphere", "cylinder", "cone"].includes(fit.kind) ||
        !Array.isArray(fit.center) ||
        fit.center.length !== 3 ||
        !fit.center.every(Number.isFinite) ||
        !Array.isArray(fit.axis) ||
        fit.axis.length !== 3 ||
        !fit.axis.every(Number.isFinite) ||
        !Math.hypot(...fit.axis)
      )
        throw new Error(
          "Deviation requires a valid fit result with finite center and nonzero axis.",
        );
      if (
        fit.kind !== "plane" &&
        (!(fit.radius > 0) || !Number.isFinite(fit.radius))
      )
        throw new Error("Deviation requires a positive finite fitted radius.");
      if (
        fit.kind === "cone" &&
        (!(fit.height > 0) ||
          !Number.isFinite(fit.height) ||
          !(fit.topRadius >= 0) ||
          !Number.isFinite(fit.topRadius))
      )
        throw new Error("Cone deviation requires finite height and topRadius.");
      const d = deviations(e.positions, fit);
      let sum = 0,
        max = 0;
      for (const v of d) {
        sum += v * v;
        max = Math.max(max, Math.abs(v));
      }
      return {
        rms: Math.sqrt(sum / d.length),
        maxError: max,
        artifact: json(c, Array.from(d), "deviations.json"),
      };
    },
    analysis_measure: (a) => ({
      distance: Math.hypot(
        ...a.first.map((v: number, i: number) => v - a.second[i]),
      ),
      units: "mm",
    }),
    cad_create: async (a, c) => {
      const s = host.snapshot(),
        cad = host.cad(),
        result = await createCadFeature(cad, s.entities, a.recipe, a.name, {
          hideInputs: a.hideInputs,
          signal: c.signal,
        });
      try {
        commit(c, result.entities, "Create CAD feature");
      } catch (error) {
        await releaseCreated(cad, result.entities, s.entities);
        throw error;
      }
      return {
        entityIds: result.created.map((e) => e.id),
        featureId: result.created[0].parametric!.feature.id,
      };
    },
    cad_rebuild: async (a, c) => {
      const s = host.snapshot(),
        cad = host.cad(),
        result = await rebuildCadFeature(
          cad,
          s.entities,
          s.history,
          s.future,
          a.entityId,
          a.recipe,
          c.signal,
        );
      try {
        commit(c, result.entities, "Rebuild CAD feature");
      } catch (error) {
        await releaseCreated(cad, result.entities, s.entities);
        throw error;
      }
      return {
        rebuiltFeatureIds: result.rebuiltFeatureIds,
        cleanupFailures: result.cleanupFailures,
      };
    },
    sketch_get: () => {
      const s = host.snapshot();
      return {
        sketch: s.sketchDraft ?? s.authoring.sketch,
        sketches: s.authoring.sketches,
        activeSketchId: s.authoring.activeSketchId,
      };
    },
    sketch_set: (a, c) => {
      validateSketch(a.sketch);
      c.check();
      host.setSketch(structuredClone(a.sketch));
      return { updated: true };
    },
    sketch_solve: (a, c) => {
      const s = host.snapshot(),
        sketch = a.sketch ?? s.sketchDraft ?? s.authoring.sketch;
      if (!sketch) throw new Error("No active sketch.");
      const solution = solveSketch(sketch, a.tolerance, a.maxIterations);
      if (a.apply) {
        c.check();
        host.setSketch(solution.sketch);
      }
      return solution;
    },
    surface_get: (a) => {
      const e = object(host.snapshot(), a.entityId);
      if (!e.surfacePatch) throw new Error("Object has no surface patch.");
      return { patch: e.surfacePatch, scanId: e.surfaceScanId };
    },
    surface_set: (a, c) => {
      const s = host.snapshot();
      const e = a.entityId
        ? object(s, a.entityId)
        : ({
            id: id(),
            name: a.name ?? "NURBS surface",
            kind: "mesh",
            positions: [],
            color: DEFAULT_FREEFORM_COLOR,
            visible: true,
            opacity: 1,
          } as Entity);
      if (a.entityId) editable(e, true);
      validatePatch(a.patch);
      const positions = tessellatePatch(a.patch);
      commit(
        c,
        a.entityId
          ? s.entities.map((x) =>
              x.id === e.id
                ? {
                    ...meshEdited(e, positions),
                    surfacePatch: structuredClone(a.patch),
                  }
                : x,
            )
          : [
              ...s.entities,
              { ...e, positions, surfacePatch: structuredClone(a.patch) },
            ],
        "Update surface",
      );
      return { entityId: e.id };
    },
    surface_fit: async (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId);
      const fit = await fitGridSurfaceAsync(
        selectedPositions(s, e, a.selectionOnly),
        a.options,
        {
          signal: c.signal,
          onProgress: () => c.progress(0.5, "Fitting surface"),
        },
      );
      const entity: Entity = {
        id: id(),
        name: a.name ?? `${e.name} fitted surface`,
        kind: "mesh",
        positions: tessellatePatch(fit.patch),
        surfacePatch: fit.patch,
        surfaceScanId: e.id,
        color: e.color,
        visible: true,
        opacity: 1,
      };
      commit(c, [...s.entities, entity], "Fit surface");
      const { patch: _patch, ...report } = fit;
      return { entityId: entity.id, ...report };
    },
    project_import: async (a, c) => {
      const s = host.snapshot(),
        blob = c.artifactBlob(a.artifactId),
        name = (blob as File).name ?? a.name ?? "import.stl",
        extension = name.split(".").pop()?.toLowerCase();
      if (extension === "scanforge" || extension === "json") {
        if (!a.replace)
          throw new Error("Project import requires replace:true.");
        const session = await decodeProjectFile(blob),
          project = validateProject(session.project),
          cad = new CadClient();
        let transferred = false;
        try {
          const cache = new Map<string, KernelMesh>();
          const restore = async (entities: Entity[]) => {
            const restored: Entity[] = [];
            for (const e of entities) {
              abort(c.signal);
              let output: KernelMesh | undefined;
              if (e.brep) {
                output = cache.get(e.brep);
                if (!output) {
                  output = await cad.importFile(
                    new TextEncoder().encode(e.brep),
                    "brep",
                  );
                  cache.set(e.brep, output);
                }
              }
              restored.push({ ...e, ...output });
            }
            return restored;
          };
          const restored = await restore(project.entities);
          const history: Revision[] = [],
            future: Revision[] = [];
          for (const revision of session.history)
            history.push({
              ...revision,
              entities: await restore(revision.entities),
            });
          for (const revision of session.future)
            future.push({
              ...revision,
              entities: await restore(revision.entities),
            });
          c.check();
          host.replace({ ...project, entities: restored }, cad, {
            history,
            future,
          });
          transferred = true;
          return { objects: restored.length };
        } finally {
          if (!transferred) cad.dispose();
        }
      }
      let entity: Entity;
      if (["step", "stp", "iges", "igs", "brep"].includes(extension ?? "")) {
        const cad = host.cad(),
          mesh = await cad.importFile(
            new Uint8Array(await blob.arrayBuffer()),
            extension as "step",
          );
        entity = {
          ...mesh,
          id: id(),
          name,
          kind: "cad",
          visible: true,
          color: DEFAULT_PART_COLOR,
          opacity: 1,
        };
        try {
          c.check();
        } catch (error) {
          await cad.release([mesh.kernelId]);
          throw error;
        }
      } else {
        const positions = await importScan(new File([blob], name), {
          unit: a.unit ?? "mm",
          signal: c.signal,
          onProgress: (f) => c.progress(f, "Importing scan"),
        });
        entity = {
          id: id(),
          name,
          kind: "mesh",
          positions,
          visible: true,
          color: DEFAULT_PART_COLOR,
          opacity: 1,
        };
      }
      try {
        if (a.replace) {
          const project: Project = {
            format: "maliev-scanforge",
            version: 1,
            name,
            units: "mm",
            entities: [entity],
          };
          c.check();
          host.replace(project);
        } else commit(c, [...s.entities, entity], "Import object");
      } catch (error) {
        if (entity.kernelId) await host.cad().release([entity.kernelId]);
        throw error;
      }
      return { entityId: entity.id, triangles: entity.positions.length / 9 };
    },
    project_export: async (a, c) => {
      const s = host.snapshot(),
        entities =
          a.visible === false
            ? s.entities
            : s.entities.filter((e) => e.visible);
      let data: Blob | Uint8Array, name: string, mime: string;
      if (a.format === "project") {
        data = await encodeProjectFile({
          project: {
            format: "maliev-scanforge",
            version: 1,
            name: s.name,
            units: "mm",
            entities: s.entities,
            authoring: s.authoring,
          },
          history: s.history,
          future: s.future,
        });
        name = `${s.name}.scanforge`;
        mime = "application/x-scanforge";
      } else if (a.format === "step") {
        if (!entities.length || entities.some((e) => !e.kernelId))
          throw new Error(
            "STEP export requires exact CAD for every exported object.",
          );
        data = await host.cad().exportStep(entities.map((e) => e.kernelId!));
        name = `${s.name}.step`;
        mime = "application/step";
      } else {
        const stl = exportStl(entities);
        data = new Uint8Array(stl.buffer, stl.byteOffset, stl.byteLength);
        name = `${s.name}.stl`;
        mime = "model/stl";
      }
      c.check();
      return c.artifact(data, name, mime);
    },
    history_undo: (_a, c) => {
      c.check();
      host.undo();
      return { updated: true };
    },
    history_redo: (_a, c) => {
      c.check();
      host.redo();
      return { updated: true };
    },
    viewport_set: (a, c) => {
      c.check();
      host.view(a.view);
      return { view: a.view };
    },
    settings_set: (a, c) => {
      c.check();
      host.settings(a.patch);
      return { updated: true };
    },
  };
}
