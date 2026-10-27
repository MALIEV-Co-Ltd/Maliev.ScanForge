import { flipSourceTopology } from "../scan-flip-request";
import { scanSplitCutter } from "../scan-split-cutter";
import { scanSegmentPublication } from "../scan-segment-publication";
import { projectedBoundarySketches } from "../scan-boundary-sketch";
import { spatialBoundarySketch } from "../scan-boundary-spatial-publication";
import { geometryArtifact } from "./geometry-artifact";
import { SCAN_TOPOLOGY_TOLERANCE } from "../scan-topology-tolerance";
import { createInspectionOperations } from "./inspection-operations";
import { inspectSection, measureGeometry } from "../inspection";
import { bindShrinkwrap } from "../shrinkwrap-request";
import { bindAverageMeshes } from "../scan-average-request";
import { bindUnrollReference } from "../scan-unroll-reference";
import { createUnrollAuxiliaries } from "../scan-unroll-auxiliary";
import { inspectReferenceFrame } from "../reference-frame";
import { validateSavedSketchDisplay } from "../saved-sketch-display";
import { createScanPreviewOperation } from "./scan-preview-operations";
import {
  reconstructionTargets,
  reconstructionScanInputs,
  reconstructionMethod,
  bindNativeReconstruction,
} from "../scan-reconstruction-targets";
import { backgroundMeshPreparation } from "../scan-background-preparation";
import { createInteractiveOperations } from "./interactive-alignment-operations";
import { isSampledScan } from "../scan-source";
import { renameObjects } from "../object-renaming";
import { autoColorScene } from "../scene-auto-color";
import { createAlignmentOperations } from "./alignment-operations";
import { createDatumOperations } from "./datum-operations";
import { createGlobalAlignmentOperations } from "./global-alignment-operations";
import type { Entity, Project, Positions, KernelMesh } from "../types";
import { cloudPlacement } from "../point-cloud-placement";
import { validateBridgePreview, bridgePreviewResponse } from "./bridge-preview";
import {
  listBackups,
  backupProjectId,
  BACKUP_INTERVAL_MS,
} from "../project-backup";
import {
  DEFAULT_PART_COLOR,
  DEFAULT_FREEFORM_COLOR,
  DEFAULT_POINT_SIZE,
  DEFAULT_POINT_DENSITY,
  validatePointCloudDisplay,
} from "../appearance";
import { CadClient } from "../cad/client";
import { prepareImportedScan } from "../imported-scan";
import { DEFAULT_ASC_ATTRIBUTES } from "../asc-import";
import { beginWorkingJob } from "../working-job-status";
import {
  importBatch,
  importConcurrency,
  validateImportBatch,
} from "../import-batch";
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
import { duplicateObject, toggleObjectVisibility } from "../object-operations";
import { resolveConstructionIdentities } from "../reference-construction-identity";
import { scanMeshCopy } from "../scan-mesh-copy";
import { partitionMeshSelection } from "../mesh-selection-edit";
import {
  assertSampledGeometry,
  inspectReferenceEntity,
} from "../reference-entity";
import { partitionTriangles, selectionCount } from "../selection";
import {
  meshStats,
  fitPlane,
  fitSphere,
  fitCylinder,
  fitCone,
} from "../geometry";
import { processMesh, type ProcessingRequest } from "../processing-client";
import { processScanRegistration } from "../scan-registration";
import { alignmentTriangleMask } from "../registration-selection";
import { registrationTargetPoints } from "../registration-target";
import { editPointCloud } from "../point-cloud-processing";
import { validateSketch, solveSketch } from "../sketch";
import { cornerTrimSketch } from "../sketch-corner";
import { filletSketchCorner } from "../sketch-fillet";
import { trimSketchStroke } from "../sketch-trim";
import { mirrorSketch } from "../sketch-mirror";
import { digestEntityGeometry } from "../geometry-digest";
import { validatePatch, tessellatePatch } from "../surfaces";
import { createSurfaceFitOperation } from "./surface-fit-operations";
import {
  retainIndexedMesh,
  indexedMeshMatches,
  transformIndexedMesh,
  indexedRenderNormals,
} from "../indexed-mesh";
import { nativeSurfaceRefinementRequest } from "../native-surface-refinement";
import { prepareLandmarkRefinementTargets } from "../landmark-alignment";
import { rotatePointNormals } from "../point-cloud";
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
function sampledObject(state: WorkspaceSnapshot, entityId: string) {
  const entity = object(state, entityId);
  assertSampledGeometry(entity);
  return entity;
}
function editable(entity: Entity, meshOnly = false) {
  if (entity.locked) throw new Error("Object is locked.");
  assertSampledGeometry(entity);
  if (meshOnly && entity.kind === "pointcloud")
    throw new Error(
      "This tool requires triangle mesh geometry, not a point cloud.",
    );
  if (meshOnly && (entity.kernelId || entity.parametric))
    throw new Error("Create a mesh copy before editing exact CAD geometry.");
}
function summary(e: Entity, scene: readonly Entity[]) {
  const reference =
    inspectReferenceFrame(e) ?? inspectReferenceEntity(e, scene);
  const {
    positions,
    normals: _normals,
    edgePositions: _edges,
    brep: _brep,
    kernelId: _kernel,
    meshSelection: _selection,
    indexedMesh: _indexedMesh,
    pointCloudPlacement: _placement,
    pointColors: _pointColors,
    reference: _reference,
    coordinateFrame: _coordinateFrame,
    ...metadata
  } = e;
  return {
    ...metadata,
    ...(e.kind === "pointcloud"
      ? {
          pointSize: e.pointSize ?? DEFAULT_POINT_SIZE,
          pointAutoDensity: e.pointAutoDensity ?? true,
          pointDensity: e.pointDensity ?? DEFAULT_POINT_DENSITY,
          pointColorMode: e.pointColorMode ?? "source",
        }
      : {}),
    ...(e.pointColors
      ? {
          pointColorAttributes: {
            encoding: "rgba8",
            points: e.pointColors.length / 4,
            bytes: e.pointColors.byteLength,
          },
        }
      : {}),
    pointCloudPose: cloudPlacement(e)?.matrixBits,
    ...(e.indexedMesh
      ? {
          indexedTopology: {
            vertices: e.indexedMesh.vertices.length / 3,
            triangles: e.indexedMesh.triangles.length / 3,
          },
        }
      : {}),
    ...(reference ??
      (e.kind === "pointcloud"
        ? { points: positions.length / 3 }
        : { triangles: positions.length / 9 })),
    ...(e.kind === "mesh" && !e.kernelId && !e.parametric
      ? { meshPreparation: backgroundMeshPreparation(e.positions) }
      : {}),
    exactCad: !!e.kernelId,
    hasBrep: !!e.brep,
  };
}
function mask(state: WorkspaceSnapshot, e: Entity, required = true) {
  assertSampledGeometry(e);
  const slots = e.positions.length / (e.kind === "pointcloud" ? 3 : 9);
  const selection = state.selectedId === e.id ? state.selection : null;
  if (!selection || selection.length !== slots) {
    if (required)
      throw new Error(
        `Select ${e.kind === "pointcloud" ? "points" : "triangles"} on the specified object first.`,
      );
    return new Uint8Array(slots);
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
  assertSampledGeometry(e);
  if (!selectionOnly) return e.positions;
  return e.kind === "pointcloud"
    ? editPointCloud({
        kind: "pointCloudEdit",
        action: "extract",
        positions: e.positions,
        selection: mask(state, e),
      }).positions!
    : partitionTriangles(e.positions, mask(state, e)).selected;
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
  const finishSelectionEdit = (
    source: Entity,
    next: Entity[],
    copy?: Entity,
  ) => {
    const remaining = next.find((entity) => entity.id === source.id);
    const stride = source.kind === "pointcloud" ? 3 : 9;
    if (remaining && remaining.positions === source.positions)
      host.setSelection(
        remaining.id,
        new Uint8Array(remaining.positions.length / stride),
      );
    if (copy)
      host.setSelection(
        copy.id,
        new Uint8Array(copy.positions.length / stride),
      );
    else if (!remaining)
      host.select(source.kind === "pointcloud" ? null : (next[0]?.id ?? null));
  };
  const commit = (c: CommandContext, entities: Entity[], label: string) => {
    const write = () => host.commit(entities.map(retainIndexedMesh), label);
    if (c.mutate) c.mutate(write);
    else {
      c.check();
      write();
    }
  };
  async function publishImportedEntity(
    entity: Entity,
    a: { replace?: boolean },
    c: CommandContext,
    fit = true,
  ) {
    const name = entity.name;
    try {
      if (a.replace) {
        const project: Project = {
          format: "maliev-scanforge",
          version: 1,
          name,
          units: "mm",
          entities: [entity],
        };
        if (c.mutate) c.mutate(() => host.replace(project));
        else {
          c.check();
          host.replace(project);
        }
      } else commit(c, [...host.snapshot().entities, entity], "Import object");
    } catch (error) {
      if (entity.kernelId) await host.cad().release([entity.kernelId]);
      throw error;
    }
    const show = () => {
      host.select(entity.id);
      if (fit) host.view("fit");
    };
    if (c.mutate) c.mutate(show);
    else show();
    c.progress(0.98, "Rendering imported object");
    try {
      await host.present?.(c.signal);
    } catch (error) {
      if (!c.signal.aborted) throw error;
    }
    return entity.kind === "pointcloud"
      ? { entityId: entity.id, points: entity.positions.length / 3 }
      : { entityId: entity.id, triangles: entity.positions.length / 9 };
  }
  async function importObject(
    a: Parameters<Handler>[0],
    c: CommandContext,
    fit = true,
  ) {
    const s = host.snapshot(),
      blob = c.artifactBlob(a.artifactId),
      name = (blob as File).name ?? a.name ?? "import.stl",
      extension = name.split(".").pop()?.toLowerCase();
    if (extension === "scanforge" || extension === "json") {
      if (!a.replace) throw new Error("Project import requires replace:true.");
      const session = await decodeProjectFile(blob, c.signal),
        project = session.project,
        cad = new CadClient();
      let transferred = false;
      try {
        const cache = new Map<string, string>();
        const restore = async (entities: Entity[]) => {
          const restored: Entity[] = [];
          for (const e of entities) {
            abort(c.signal);
            let kernelId: string | undefined;
            if (e.brep) {
              kernelId = cache.get(e.brep);
              if (!kernelId) {
                const output = await cad.importFile(
                  new TextEncoder().encode(e.brep),
                  "brep",
                );
                kernelId = output.kernelId;
                cache.set(e.brep, kernelId);
              }
            }
            // Rehydrate native ownership without replacing the saved exact/display data.
            restored.push(kernelId ? { ...e, kernelId } : e);
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
        const publish = () => {
          host.replace({ ...project, entities: restored }, cad, {
            history,
            future,
            projectId: a.recoveryProjectId ?? session.projectId,
          });
          transferred = true;
          if (fit) host.view("fit");
        };
        if (c.mutate) c.mutate(publish);
        else publish();
        c.progress(0.98, "Rendering restored project");
        await host.present?.(c.signal);
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
      entity = await prepareImportedScan(new File([blob], name), {
        unit: a.unit ?? "mm",
        placeAtOrigin:
          a.placeAtOrigin ?? s.settings?.importPlaceAtOrigin === true,
        ascAttributes:
          a.ascAttributes ??
          s.settings?.importAscAttributes ??
          DEFAULT_ASC_ATTRIBUTES,
        signal: c.signal,
        onProgress: (fraction) => c.progress(fraction, "Importing scan"),
      });
    }
    return publishImportedEntity(entity, a, c, fit);
  }
  const operations: Record<string, Handler> = {
    scan_preview: createScanPreviewOperation(host),
    ...createAlignmentOperations(host),
    ...createDatumOperations(host),
    ...createGlobalAlignmentOperations(host),
    ...createInteractiveOperations(host),
    project_get: () => {
      const s = host.snapshot();
      return {
        name: s.name,
        projectId: s.projectId,
        units: "mm",
        objects: s.entities.map((entity) => summary(entity, s.entities)),
        selectedId: s.selectedId,
        selectedIds: s.selectedIds ?? (s.selectedId ? [s.selectedId] : []),
        selectionAnchorId: s.selectionAnchorId ?? s.selectedId,
        undo: s.history.length,
        redo: s.future.length,
        authoring: s.authoring,
        settings: s.settings,
      };
    },
    backup_list: async (a, c) => ({
      intervalMs: BACKUP_INTERVAL_MS,
      changedProjectsOnly: true,
      projectId: host.snapshot().projectId,
      backups: (await listBackups()).map((backup) => ({
        id: backup.id,
        projectId: backupProjectId(backup.id),
        name: backup.name,
        savedAt: backup.savedAt,
        bytes: backup.file.size,
        snapshot: backup.id.endsWith(":previous") ? "previous" : "latest",
        ...(backup.thumbnail && a.includeThumbnails
          ? {
              thumbnail: c.artifact(
                backup.thumbnail,
                `${backup.name}.webp`,
                backup.thumbnail.type,
              ),
            }
          : {}),
      })),
    }),
    backup_delete: async (a, c) => {
      c.check();
      if (!host.deleteBackup) throw new Error("Backup deletion unavailable");
      const backup = (await listBackups()).find(
        (item) => item.id === a.backupId,
      );
      if (!backup) throw new Error("Backup not found");
      c.check();
      await host.deleteBackup(backup.id);
      return {
        deletedProjectId: backupProjectId(backup.id),
        automaticBackupsPaused:
          host.snapshot().projectId === backupProjectId(backup.id),
      };
    },
    backup_restore: async (a, c) => {
      if (!a.replace) throw new Error("Backup restore requires replace:true.");
      const backup = (await listBackups()).find(
        (item) => item.id === a.backupId,
      );
      if (!backup) throw new Error("Backup not found");
      c.check();
      return operations.project_import(
        {
          artifactId: "backup",
          name: `${backup.name}.scanforge`,
          replace: true,
          recoveryProjectId: backupProjectId(backup.id),
        },
        { ...c, artifactBlob: () => backup.file },
      );
    },
    object_geometry_digest: (a, c) =>
      digestEntityGeometry(object(host.snapshot(), a.entityId), {
        signal: c.signal,
        check: c.check,
        onProgress: (fraction) => c.progress(fraction, "Hashing geometry"),
      }),
    object_get: (a, c) => {
      const state = host.snapshot(),
        e = object(state, a.entityId);
      const details = summary(e, state.entities);
      return {
        ...details,
        ...(a.includeGeometry
          ? {
              geometry: geometryArtifact(
                c,
                "coordinateFrame" in details && details.coordinateFrame
                  ? {
                      units: "mm",
                      coordinateFrame: details.coordinateFrame,
                      coordinateFrameEncoding: details.coordinateFrameEncoding,
                      rollMapping: e.rollMapping,
                    }
                  : "reference" in details
                    ? {
                        units: "mm",
                        semantic: details.reference.geometry,
                        encoding: details.reference.geometryEncoding,
                      }
                    : {
                        positions: e.positions,
                        indexedMesh: e.indexedMesh
                          ? {
                              vertices: e.indexedMesh.vertices,
                              triangles: e.indexedMesh.triangles,
                              ...(e.indexedMesh.facetNormals
                                ? { facetNormals: e.indexedMesh.facetNormals }
                                : {}),
                              ...(e.indexedMesh.normals
                                ? { normals: e.indexedMesh.normals }
                                : {}),
                              ...(e.indexedMesh.geometryNormals
                                ? {
                                    geometryNormals:
                                      e.indexedMesh.geometryNormals,
                                  }
                                : {}),
                            }
                          : undefined,
                        normals: e.normals ? e.normals : undefined,
                        pointColors: e.pointColors ? e.pointColors : undefined,
                        edgePositions: e.edgePositions,
                      },
              ),
            }
          : {}),
      };
    },
    object_visibility_toggle: (a, c) => {
      const state = host.snapshot();
      const ids =
        a.entityIds ??
        state.selectedIds ??
        (state.selectedId ? [state.selectedId] : []);
      const next = toggleObjectVisibility(state.entities, ids);
      commit(c, next, "Toggle object visibility");
      const targets = new Set(ids);
      return {
        objects: next
          .filter((entity) => targets.has(entity.id))
          .map((entity) => ({ entityId: entity.id, visible: entity.visible })),
      };
    },
    scene_auto_color: (_a, c) => {
      c.check();
      const state = host.snapshot();
      const result = autoColorScene(state.entities);
      const showColors = state.settings.normalsDisplay !== false;
      if (result.changed || showColors) {
        const write = () => {
          if (result.changed)
            host.commit(
              result.entities.map(retainIndexedMesh),
              "Auto colorize objects",
            );
          if (showColors) host.settings({ normalsDisplay: false });
        };
        if (c.mutate) c.mutate(write);
        else {
          c.check();
          write();
        }
      }
      return {
        changed: result.changed,
        normalsDisplay: false,
        objects: result.entities.map((entity) => ({
          entityId: entity.id,
          color: entity.color,
        })),
      };
    },
    object_rename: (a, c) => {
      const s = host.snapshot();
      const ids =
        a.entityIds ?? s.selectedIds ?? (s.selectedId ? [s.selectedId] : []);
      const next = renameObjects(s.entities, ids, a.name);
      commit(c, next, ids.length > 1 ? "Rename objects" : "Rename object");
      const targets = new Set(ids);
      return {
        objects: next
          .filter((e) => targets.has(e.id))
          .map((e) => ({ entityId: e.id, name: e.name })),
      };
    },
    object_update: (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId);
      const allowed = new Set([
        "name",
        "color",
        "pointSize",
        "pointAutoDensity",
        "pointDensity",
        "pointColorMode",
        "opacity",
        "visible",
        "locked",
        "selectable",
      ]);
      if (Object.keys(a.patch).some((k) => !allowed.has(k)))
        throw new Error("Only display and protection metadata may be updated.");
      validatePointCloudDisplay({ ...e, ...a.patch });
      if (
        e.kind !== "pointcloud" &&
        ("pointSize" in a.patch ||
          "pointColorMode" in a.patch ||
          "pointAutoDensity" in a.patch ||
          "pointDensity" in a.patch)
      )
        throw new Error("Point display options require a point cloud.");
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
      const s = host.snapshot();
      if (a.entityId !== undefined && a.entityIds !== undefined)
        throw new Error("Specify entityId or entityIds, not both.");
      const ids: string[] =
        a.entityId !== undefined
          ? [a.entityId]
          : (a.entityIds ??
            s.selectedIds ??
            (s.selectedId ? [s.selectedId] : []));
      if (!ids.length) throw new Error("Select at least one object to delete.");
      const targets = new Set(ids);
      if (targets.size !== ids.length)
        throw new Error("Object IDs must be unique.");
      for (const id of ids) {
        const e = object(s, id);
        editable(e);
        if (
          e.parametric &&
          s.entities.some(
            (x) =>
              !targets.has(x.id) &&
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
      }
      commit(
        c,
        s.entities.filter((x) => !targets.has(x.id)),
        ids.length === 1 ? "Delete object" : "Delete objects",
      );
      return {
        ...(ids.length === 1 ? { entityId: ids[0] } : {}),
        entityIds: ids,
      };
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
        elementKind: e.kind === "pointcloud" ? "points" : "triangles",
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
      assertSampledGeometry(e);
      const pointCloud = e.kind === "pointcloud";
      if (pointCloud ? !Array.isArray(a.points) : !Array.isArray(a.triangles))
        throw new Error(
          `Provide ${pointCloud ? "points" : "triangles"} indices for this object.`,
        );
      const selected = new Uint8Array(
        e.positions.length / (pointCloud ? 3 : 9),
      );
      for (const triangle of pointCloud ? a.points : a.triangles) {
        if (
          !Number.isSafeInteger(triangle) ||
          triangle < 0 ||
          triangle >= selected.length
        )
          throw new Error(
            `${pointCloud ? "Point" : "Triangle"} index is out of bounds.`,
          );
        selected[triangle] = 1;
      }
      for (const hidden of e.meshSelection?.hidden ?? []) selected[hidden] = 0;
      c.check();
      host.setSelection(e.id, selected);
      return { count: selectionCount(selected) };
    },
    selection_edit: (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId);
      editable(e, e.kind !== "pointcloud" && a.operation !== "copy");
      if (e.kind === "pointcloud") {
        const selection = mask(s, e);
        const extracted = editPointCloud({
          kind: "pointCloudEdit",
          action: "extract",
          positions: e.positions,
          normals: e.normals,
          pointColors: e.pointColors,
          selection,
        });
        let next = s.entities;
        let copy: Entity | undefined;
        if (a.operation !== "delete") {
          copy = {
            ...e,
            id: id(),
            name: `${e.name} selection`,
            positions: extracted.positions!,
            pointColors: extracted.pointColors,
            pointCloudPlacement: undefined,
            normals: extracted.normals
              ? Array.from(extracted.normals)
              : undefined,
            meshSelection: undefined,
          };
          next = [...next, copy];
        }
        if (a.operation !== "copy") {
          const remainder = editPointCloud({
            kind: "pointCloudEdit",
            action: "delete",
            positions: e.positions,
            normals: e.normals,
            pointColors: e.pointColors,
            selection,
          });
          next = remainder.positions!.length
            ? next.map((entity) =>
                entity.id === e.id
                  ? {
                      ...e,
                      positions: remainder.positions!,
                      pointColors: remainder.pointColors,
                      pointCloudPlacement: undefined,
                      normals: remainder.normals
                        ? Array.from(remainder.normals)
                        : undefined,
                      meshSelection: undefined,
                    }
                  : entity,
              )
            : next.filter((entity) => entity.id !== e.id);
        }
        commit(c, next, `${a.operation} selected points`);
        finishSelectionEdit(e, next, copy);
        return { entityId: copy?.id, points: extracted.positions!.length / 3 };
      }
      const parts = partitionMeshSelection(e, mask(s, e), id());
      let next = s.entities;
      let copy: Entity | undefined;
      if (a.operation !== "delete") {
        copy = parts.selected;
        next = [...next, copy];
      }
      if (a.operation !== "copy")
        next = parts.remainder.positions.length
          ? next.map((x) => (x.id === e.id ? parts.remainder : x))
          : next.filter((x) => x.id !== e.id);
      commit(c, next, `${a.operation} selected triangles`);
      finishSelectionEdit(e, next, copy);
      return {
        entityId: copy?.id,
        triangles: parts.selected.positions.length / 9,
      };
    },
    mesh_analyze: async (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId);
      assertSampledGeometry(e);
      if (e.kind === "pointcloud")
        throw new Error("Point clouds do not have triangle topology.");
      const result = await processMesh(
        {
          kind: "report",
          positions: e.positions,
          tolerance: a.tolerance ?? SCAN_TOPOLOGY_TOLERANCE,
        },
        { signal: c.signal, onProgress: c.progress, reuseTopology: true },
      );
      c.check();
      return {
        stats: meshStats(e.positions),
        topology: result.topology,
        diagnostics: result.diagnostics,
      };
    },
    mesh_process: async (a, c) => {
      const bridgePreview = validateBridgePreview(a);
      const s = host.snapshot();
      let e = sampledObject(s, a.entityId);
      const op = structuredClone(a.operation);
      const kind = op.kind as ProcessingRequest["kind"];
      if (
        op.createSketches !== undefined &&
        (kind !== "scanEdit" ||
          op.action !== "boundaryProject" ||
          typeof op.createSketches !== "boolean")
      )
        throw Error(
          "createSketches is boolean and supported only for boundary projection (boundaryProject).",
        );
      const publishBoundarySketches = op.createSketches === true;
      const publishSpatialSketch =
        kind === "scanEdit" && op.action === "boundarySpatialSketch";
      if (publishSpatialSketch && a.selectionOnly)
        throw Error(
          "Spatial boundary sketches use boundary indices; omit selectionOnly.",
        );
      delete op.createSketches;
      if (publishBoundarySketches || publishSpatialSketch) editable(e);
      let unroll: Awaited<ReturnType<typeof bindUnrollReference>> | undefined;
      let average: ReturnType<typeof bindAverageMeshes> | undefined;
      const reconstruction =
        kind === "scanTools" && op.operation?.kind === "repolygonize";
      let nativeReconstruction:
        ReturnType<typeof bindNativeReconstruction> | undefined;
      if (kind === "scanTools" && op.operation.kind === "averageMesh") {
        if (a.selectionOnly)
          throw new Error(
            "Average mesh processes whole inputs; omit selectionOnly.",
          );
        editable(e, true);
        if (a.targetId && a.targetIds !== undefined)
          throw new Error(
            "Average mesh accepts targetId or targetIds, not both.",
          );
        const targetIds = a.targetIds ?? (a.targetId ? [a.targetId] : []);
        if (Array.isArray(targetIds))
          for (const targetId of targetIds) sampledObject(s, targetId);
        average = bindAverageMeshes(e, targetIds, s.entities);
        e = average.source;
      }
      if (!reconstruction && Array.isArray(a.targetIds) && !a.targetIds.length)
        throw Error(
          "targetIds requires at least one reference for this operation.",
        );
      if (
        e.kind === "pointcloud" &&
        !["paired", "global", "icp", "pointCloudEdit"].includes(kind) &&
        !reconstruction
      )
        throw new Error("This operation requires triangle mesh geometry.");
      if (kind === "pointCloudEdit" && e.kind !== "pointcloud")
        throw new Error("Point-cloud editing requires a point cloud.");
      if (reconstruction && a.selectionOnly)
        throw Error("Reconstruction uses whole inputs; omit selectionOnly.");
      const readonly =
        [
          "report",
          "connectedSelection",
          "selectionMorphology",
          "sketchSection",
          "scanPreview",
        ].includes(kind) ||
        (kind === "pointCloudEdit" &&
          ["connectedSelection", "grow", "shrink"].includes(op.action)) ||
        (kind === "scanEdit" &&
          ["inventory", "boundaryProject"].includes(op.action));
      if (!readonly) editable(e, e.kind !== "pointcloud");
      if (
        "positions" in op ||
        "normals" in op ||
        "target" in op ||
        "selection" in op ||
        "sourceTriangleMask" in op ||
        "sourceIndexed" in op ||
        "targetIndexed" in op ||
        "additionalTargets" in op ||
        "refinementTargets" in op ||
        "deferCloudTransform" in op ||
        "outputPlacement" in op ||
        "seeds" in op
      )
        throw new Error(
          "Geometry and selection must refer to workspace objects.",
        );
      if (
        e.kind === "pointcloud" &&
        ["paired", "icp", "global"].includes(kind) &&
        a.selectionOnly
      )
        throw new Error(
          "Point-cloud registration moves the whole source; omit selectionOnly.",
        );
      if (
        kind === "sketchSection" &&
        a.selectionOnly !== undefined &&
        a.selectionOnly !== op.options.selectedOnly
      )
        throw new Error(
          "For sketchSection, selectionOnly must match options.selectedOnly; omit the top-level flag otherwise.",
        );
      const selection = (
        kind === "sketchSection" ? op.options.selectedOnly : a.selectionOnly
      )
        ? mask(s, e)
        : undefined;
      if (
        a.targetIds !== undefined &&
        kind !== "nativeRefine" &&
        !(
          kind === "scanTools" &&
          ["repolygonize", "shrinkwrap", "averageMesh"].includes(
            op.operation.kind,
          )
        )
      )
        throw new Error(
          "targetIds is supported only for surface refinement, re-polygonize, ShrinkWrap or Average mesh.",
        );
      if (
        selection &&
        !readonly &&
        ![
          "scanEdit",
          "scanTools",
          "icp",
          "global",
          "pointCloudEdit",
          "nativeRefine",
        ].includes(kind) &&
        !a.createNew
      )
        throw new Error(
          "Selection-only processing requires createNew:true for this operation.",
        );
      if (
        kind === "scanTools" &&
        op.operation.kind === "unroll" &&
        op.operation.cylinderId !== undefined
      ) {
        unroll = await bindUnrollReference(
          op.operation,
          e,
          s.entities,
          (kernelId) => host.cad().alignmentReferences(kernelId),
          () => c.check(),
        );
        op.operation = unroll.operation;
      }
      const request = {
        ...op,
        ...(bridgePreview ? { previewOnly: true } : {}),
        positions:
          selection &&
          ![
            "scanEdit",
            "scanTools",
            "icp",
            "nativeRefine",
            "global",
            "pointCloudEdit",
            "sketchSection",
          ].includes(kind)
            ? partitionTriangles(e.positions, selection).selected
            : e.positions,
      } as ProcessingRequest;
      if (
        (kind === "paired" || kind === "icp" || kind === "global") &&
        e.kind === "mesh" &&
        request.positions === e.positions
      )
        Object.assign(request, { sourceIndexed: e.indexedMesh });
      if (kind === "pointCloudEdit")
        Object.assign(request, {
          normals: e.normals,
          pointColors: e.pointColors,
          selection: [
            "delete",
            "extract",
            "connectedSelection",
            "grow",
            "shrink",
          ].includes(op.action)
            ? mask(s, e)
            : selection,
        });
      if (kind === "icp" || kind === "global") {
        if (!a.targetId) throw new Error("Alignment requires targetId.");
        Object.assign(request, {
          target:
            kind === "icp"
              ? registrationTargetPoints(sampledObject(s, a.targetId))
              : sampledObject(s, a.targetId).positions,
          sourceTriangleMask:
            kind === "icp" && e.kind !== "pointcloud"
              ? alignmentTriangleMask(
                  e.positions.length / 9,
                  selection,
                  e.meshSelection?.hidden,
                )
              : selection,
        });
      }
      if (kind === "paired" && op.refineSurface) {
        if (selection)
          throw new Error(
            "Point-pair refinement moves the whole source; omit selectionOnly.",
          );
        if (!a.targetId)
          throw new Error("Point-pair surface refinement requires targetId.");
        Object.assign(
          request,
          await prepareLandmarkRefinementTargets(
            e,
            [sampledObject(s, a.targetId)],
            (kernelId) => host.cad().alignmentMesh(kernelId),
            op.workerCount ?? 2,
            op.parallel ?? true,
            { signal: c.signal, check: () => c.check() },
          ),
          { sourceTriangleMask: mask(s, e, false) },
        );
      }
      if (kind === "nativeRefine") {
        if (a.targetId && a.targetIds)
          throw new Error("Use targetId or targetIds, not both.");
        const ids = a.targetIds ?? (a.targetId ? [a.targetId] : []);
        if (
          !Array.isArray(ids) ||
          !ids.length ||
          ids.length > 32 ||
          ids.some((id) => typeof id !== "string")
        )
          throw new Error("Alignment requires one to 32 fixed targetIds.");
        Object.assign(
          request,
          nativeSurfaceRefinementRequest(
            e,
            ids.map((id) => sampledObject(s, id)),
            op.sampleBudget,
            op.initialRadius,
            selection,
            op.workerCount ?? 1,
            op.parallel ?? true,
            op.seedVertices,
          ),
        );
      }
      if (kind === "scanEdit") {
        const target = a.targetId ? sampledObject(s, a.targetId) : undefined;
        Object.assign(request, {
          selection,
          ...(indexedMeshMatches(e.indexedMesh, e.positions)
            ? { sourceIndexed: e.indexedMesh }
            : {}),
          ...(target
            ? op.action === "split" && op.plane === undefined
              ? scanSplitCutter(target)
              : { target: target.positions }
            : {}),
        });
      }
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
          sampled: isSampledScan(e.scanSource),
        });
      if (kind === "scanTools") {
        if (
          "targets" in op.operation ||
          "selection" in op.operation ||
          "targetInputs" in op.operation ||
          "inputKind" in op.operation ||
          "sourceTopology" in op.operation ||
          "targetTopology" in op.operation
        )
          throw new Error("Inner geometry must refer to workspace objects.");
        if (op.operation.kind === "shrinkwrap") {
          if (a.targetId || a.selectionOnly !== undefined)
            throw Error(
              "ShrinkWrap uses explicit scope and optional targetIds; omit targetId and selectionOnly.",
            );
          op.operation = bindShrinkwrap(
            e,
            { ...op.operation, targetIds: a.targetIds },
            s.entities,
            s.selectedId === e.id ? s.selection : undefined,
          );
          Object.assign(request, { operation: op.operation });
        }
        if (op.operation.kind === "repolygonize") {
          if (a.targetId)
            throw new Error("Reconstruction uses targetIds, not targetId.");
          if (
            a.targetIds !== undefined &&
            (!Array.isArray(a.targetIds) ||
              a.targetIds.length > 32 ||
              a.targetIds.some((id: unknown) => typeof id !== "string"))
          )
            throw new Error(
              "Reconstruction accepts one to 32 additional targetIds; omit for a single source.",
            );
          const targets = (a.targetIds ?? []).map((id: string) =>
            sampledObject(s, id),
          );
          op.operation.method = reconstructionMethod(
            e,
            targets,
            op.operation.method,
          );
          if (op.operation.method === "voxel" && a.targetIds?.length === 0)
            throw Error(
              "Reconstruction accepts one to 32 additional targetIds; omit for a single source.",
            );
          if (op.operation.method === "native") {
            nativeReconstruction = bindNativeReconstruction(
              e,
              a.targetIds,
              s.entities,
            );
            if (a.createNew ?? true)
              nativeReconstruction.inputs.forEach((input) =>
                editable(input, true),
              );
            request.positions = nativeReconstruction.source.positions;
            op.operation.sourceTopology =
              nativeReconstruction.source.indexedMesh;
            op.operation.targetTopology = nativeReconstruction.references.map(
              (input) => input.indexedMesh,
            );
            op.operation.targets = nativeReconstruction.references.map(
              (input) => input.positions,
            );
          } else if (
            [e, ...targets].some(
              (entity: Entity) => entity.kind === "pointcloud",
            )
          ) {
            op.operation.inputKind =
              e.kind === "pointcloud" ? "points" : "triangles";
            op.operation.targetInputs = reconstructionScanInputs(e, targets);
          } else op.operation.targets = reconstructionTargets(e, targets);
        }
        if (op.operation.kind === "averageMesh") {
          op.operation.targets = average!.references.map(
            (entity) => entity.positions,
          );
          op.operation.targetTopology = average!.references.map(
            (entity) => entity.indexedMesh,
          );
          op.operation.sourceTopology = average!.source.indexedMesh;
        }
        if (op.operation.kind === "flipNormals")
          op.operation.sourceTopology = await flipSourceTopology(e, () =>
            c.check(),
          );
        if (op.operation.kind === "reduceNoise")
          op.operation.selection = selection;
        if (selection && op.operation.kind !== "reduceNoise")
          throw new Error("This scan tool does not support selectionOnly.");
      }
      const result = await processScanRegistration(e, request, {
        signal: c.signal,
        reuseTopology: kind === "scanEdit",
        onProgress: c.progress,
        check: () => c.check(),
      });
      c.check();
      const edit = result.scanEdit;
      const boundarySketches = publishBoundarySketches
        ? projectedBoundarySketches(edit?.curves ?? [], op.plane)
        : publishSpatialSketch
          ? [spatialBoundarySketch(edit?.spatialCurves ?? [])]
          : undefined;
      if (bridgePreview) return bridgePreviewResponse(e.positions, result, c);
      const pointEdit = result.pointCloudEdit;
      const positions =
        pointEdit?.positions ?? edit?.positions ?? result.positions;
      const segments = edit?.segments ?? result.segments;
      const selected =
        pointEdit?.selection ?? edit?.selection ?? result.selection;
      let next = s.entities;
      const created: Entity[] = [];
      let unrollAuxiliary:
        ReturnType<typeof createUnrollAuxiliaries> | undefined;
      if (
        kind === "scanTools" &&
        op.operation.kind === "unroll" &&
        !positions?.length
      )
        throw Error(
          "Unroll produced no complete facets; no objects were published.",
        );
      if (positions && edit?.diagnostics.changed !== false) {
        const updated =
          result.cloudPreview ??
          (reconstruction && e.kind === "pointcloud"
            ? {
                ...scanMeshCopy(e, e.id, positions),
                name: e.name,
                visible: e.visible,
                constructionOrderKey: e.constructionOrderKey,
              }
            : e.kind === "pointcloud"
              ? {
                  ...e,
                  positions,
                  pointColors: pointEdit
                    ? pointEdit.pointColors
                    : e.pointColors,
                  pointCloudPlacement: pointEdit
                    ? undefined
                    : e.pointCloudPlacement,
                  meshSelection: pointEdit ? undefined : e.meshSelection,
                  normals: pointEdit
                    ? pointEdit.normals
                      ? Array.from(pointEdit.normals)
                      : undefined
                    : e.normals && result.registration
                      ? rotatePointNormals(
                          e.normals,
                          result.registration.transform.rotation,
                        )
                      : e.normals,
                }
              : {
                  ...meshEdited(e, positions),
                  ...(result.indexedMesh
                    ? {
                        indexedMesh: result.indexedMesh,
                        normals: indexedRenderNormals(result.indexedMesh),
                      }
                    : {}),
                });
        if (!positions.length)
          next = next.filter((entity) => entity.id !== e.id);
        else if (
          a.createNew ??
          (!!average ||
            !!nativeReconstruction ||
            (kind === "scanTools" && op.operation.kind === "unroll"))
        ) {
          updated.id = id();
          if (updated.constructionOrderKey !== undefined)
            updated.constructionOrderKey = resolveConstructionIdentities(
              [...s.entities, { id: updated.id }],
              [updated.id],
            ).orderedSources[0].constructionOrderKey;
          updated.name = nativeReconstruction
            ? `Polygonized ${(op.operation.resolution ?? 0.5).toFixed(3)} mm`
            : average
              ? "Average mesh"
              : kind === "scanTools" && op.operation.kind === "unroll"
                ? `${e.name} - Unrolled`
                : `${e.name} ${kind}`;
          created.push(updated);
          next = [...next, updated];
          if (nativeReconstruction) {
            const inputIds = new Set(
              nativeReconstruction.inputs.map((e) => e.id),
            );
            next = next.map((e) =>
              inputIds.has(e.id) ? { ...e, visible: false } : e,
            );
          }
        } else next = next.map((x) => (x.id === e.id ? updated : x));
      }
      const segmentPublication =
        segments === undefined
          ? undefined
          : scanSegmentPublication(
              next,
              e.id,
              segments,
              result.segmentClassifications,
              id,
            );
      if (segmentPublication) {
        next = segmentPublication.entities;
        created.push(...segmentPublication.created);
      }
      if (
        kind === "scanTools" &&
        op.operation.kind === "unroll" &&
        positions?.length
      ) {
        unrollAuxiliary = createUnrollAuxiliaries(op.operation, positions, {
          frameId: id(),
          sketchId: id(),
          sourceEntityId: e.id,
          meshEntityId: created[0]?.id ?? e.id,
        });
        next = [...next, unrollAuxiliary.frame];
      }
      const response = {
        ...(boundarySketches
          ? { sketchIds: boundarySketches.map((sketch) => sketch.id) }
          : {}),
        ...(unrollAuxiliary
          ? {
              unroll: {
                ...unroll?.reference,
                meshEntityId: created[0]?.id ?? e.id,
                frameEntityId: unrollAuxiliary.frame.id,
                sketchId: unrollAuxiliary.sketch.id,
                coordinateFrame: unrollAuxiliary.frame.coordinateFrame,
                mapping: unrollAuxiliary.frame.rollMapping,
              },
            }
          : {}),
        ...(nativeReconstruction
          ? {
              reconstruction: {
                inputEntityIds: nativeReconstruction.inputs.map((e) => e.id),
                method: "native",
              },
            }
          : {}),
        ...(average
          ? {
              average: {
                baseEntityId: average.source.id,
                referenceEntityIds: average.references.map(
                  (entity) => entity.id,
                ),
              },
            }
          : {}),
        entityIds: created.length
          ? created.map((x) => x.id)
          : edit?.diagnostics.changed === false || positions?.length
            ? [e.id]
            : [],
        diagnostics: edit?.diagnostics ?? result.diagnostics,
        segmentClassifications: result.segmentClassifications,
        topology: result.topology,
        registration: result.registration,
        refinement: result.refinement,
        ...(edit?.inventory ||
        edit?.curves ||
        edit?.spatialCurves ||
        result.sketchSection
          ? {
              artifact: json(
                c,
                {
                  inventory: edit?.inventory,
                  curves: edit?.curves,
                  spatialCurves: edit?.spatialCurves,
                  sketchSection: result.sketchSection,
                },
                "mesh-report.json",
              ),
            }
          : {}),
      };
      c.check();
      if (
        (positions && edit?.diagnostics.changed !== false) ||
        segmentPublication ||
        boundarySketches?.length
      )
        host.commit(
          next.map(retainIndexedMesh),
          `Mesh ${kind}`,
          boundarySketches
            ? { newModelSketches: boundarySketches }
            : unrollAuxiliary
              ? { newModelSketches: [unrollAuxiliary.sketch] }
              : segmentPublication
                ? segmentPublication.policy
                : nativeReconstruction && created.length
                  ? {
                      modelVisibilityFor: nativeReconstruction.inputs.map(
                        (e) => e.id,
                      ),
                    }
                  : undefined,
        );
      if (
        (segmentPublication || average || nativeReconstruction) &&
        created.length
      )
        host.select(created[0].id);
      if (selected) host.setSelection(e.id, selected);
      return response;
    },
    mesh_transform: (a, c) => {
      const s = host.snapshot(),
        e = object(s, a.entityId);
      editable(e, true);
      const transformed = transformIndexedMesh(
        e,
        a.translation,
        a.rotation,
        a.scale,
      );
      commit(
        c,
        s.entities.map((x) =>
          x.id === e.id
            ? {
                ...meshEdited(e, transformed.positions),
                indexedMesh: transformed.indexedMesh,
                normals: transformed.normals,
              }
            : x,
        ),
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
      c.check();
      const section = inspectSection(e, a.axis, a.offset);
      const rows = ["x1,y1,z1,x2,y2,z2"];
      for (let i = 0; i < section.segments.length; i += 6)
        rows.push(section.segments.slice(i, i + 6).join(","));
      c.check();
      return {
        units: "mm",
        axis: a.axis,
        offset: a.offset,
        scope: "visible-triangles",
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
    ...createInspectionOperations(host),
    analysis_measure: (a) =>
      measureGeometry(a as import("../inspection").MeasurementInput),
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
      if (a.selectCreated === true) host.select(result.created[0].id);
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
      const solution = a.solve ? solveSketch(a.sketch) : undefined;
      if (solution && !solution.converged)
        throw new Error(
          `Conflicting or unsolved constraints: ${solution.conflictingConstraintIds.join(", ")}`,
        );
      const state = host.snapshot();
      const saved = state.authoring.sketches?.find(
        (row) => row.id === state.authoring.activeSketchId,
      );
      if (saved?.visible && saved.kind !== "spatial")
        validateSavedSketchDisplay({
          ...saved,
          sketch: solution?.sketch ?? a.sketch,
        });
      c.check();
      host.setSketch(structuredClone(solution?.sketch ?? a.sketch));
      return { updated: true, ...(solution ? { solution } : {}) };
    },
    sketch_corner_trim: (a, c) => {
      const state = host.snapshot();
      const sketch = state.sketchDraft ?? state.authoring.sketch;
      if (!sketch) throw new Error("No active sketch.");
      const result = cornerTrimSketch(sketch, {
        first: a.first,
        second: a.second,
        firstEnd: a.firstEnd,
        secondEnd: a.secondEnd,
      });
      c.check();
      if (result.changed) host.setSketch(result.sketch);
      const { sketch: _, ...diagnostics } = result;
      return diagnostics;
    },
    sketch_corner_fillet: async (a, c) => {
      const state = host.snapshot();
      const sketch = state.sketchDraft ?? state.authoring.sketch;
      if (!sketch) throw new Error("No active sketch.");
      const result = await filletSketchCorner(
        sketch,
        {
          first: a.first,
          second: a.second,
          firstEnd: a.firstEnd,
          secondEnd: a.secondEnd,
          radiusMm: a.radiusMm,
        },
        { signal: c.signal, check: c.check },
      );
      c.check();
      host.setSketch(result.sketch);
      const { sketch: _, ...diagnostics } = result;
      return diagnostics;
    },
    sketch_trim_stroke: async (a, c) => {
      const state = host.snapshot();
      const sketch = state.sketchDraft ?? state.authoring.sketch;
      if (!sketch) throw new Error("No active sketch.");
      const result = await trimSketchStroke(
        sketch,
        { stroke: a.stroke, radiusMm: a.radiusMm },
        { signal: c.signal, check: c.check },
      );
      c.check();
      if (result.changed) host.setSketch(result.sketch);
      const { sketch: _, ...diagnostics } = result;
      return diagnostics;
    },
    sketch_mirror: async (a, c) => {
      const state = host.snapshot();
      const sketch = state.sketchDraft ?? state.authoring.sketch;
      if (!sketch) throw new Error("No active sketch.");
      const result = await mirrorSketch(
        sketch,
        { axis: a.axis, curveIds: a.curveIds },
        { signal: c.signal, check: c.check },
      );
      c.check();
      host.setSketch(result.sketch);
      const { sketch: _, ...copies } = result;
      return { changed: true, ...copies };
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
    surface_fit: createSurfaceFitOperation(host),
    project_import: (a, c) => importObject(a, c),
    project_import_batch: async (a, c) => {
      const ascAttributes =
        a.ascAttributes ??
        host.snapshot().settings?.importAscAttributes ??
        DEFAULT_ASC_ATTRIBUTES;
      const placeAtOrigin =
        a.placeAtOrigin ??
        host.snapshot().settings?.importPlaceAtOrigin === true;
      const names = a.artifactIds.map((artifactId: string) => {
        const blob = c.artifactBlob(artifactId);
        return (blob as File).name ?? "import.stl";
      });
      validateImportBatch(names);
      if (names.some((name: string) => /\.(scanforge|json)$/i.test(name)))
        throw new Error("Open project files separately from scan batches.");
      const files = (a.artifactIds as string[]).map(
        (artifactId, index) =>
          new File([c.artifactBlob(artifactId)], names[index]),
      );
      const status = beginWorkingJob("Importing files");
      let result;
      try {
        result = await importBatch(
          files,
          async (file, _index, context) => {
            c.check();
            return /\.(stl|obj|ply|asc)$/i.test(file.name)
              ? prepareImportedScan(file, {
                  unit: a.unit ?? "mm",
                  placeAtOrigin,
                  ascAttributes,
                  signal: context.signal,
                  onProgress: (fraction) =>
                    context.progress(fraction, "Importing"),
                })
              : undefined;
          },
          c.signal,
          {
            concurrency: importConcurrency(files),
            names,
            onProgress: (details) => {
              const fraction =
                details.files.reduce((sum, file) => sum + file.fraction, 0) /
                files.length;
              c.progress(fraction, "Importing files", details);
              status.progress(fraction, "Importing files", details);
            },
            commit: async (entity, _file, index) =>
              entity
                ? publishImportedEntity(
                    entity,
                    {},
                    { ...c, progress: () => {} },
                    false,
                  )
                : importObject(
                    { artifactId: a.artifactIds[index], unit: a.unit },
                    { ...c, progress: () => {} },
                    false,
                  ),
          },
        );
        if (result.completed.length) {
          const fit = () => host.view("fit");
          if (c.mutate) c.mutate(fit);
          else {
            c.check();
            fit();
          }
        }
      } finally {
        status.finish();
      }
      if (result.cancelled)
        throw new DOMException(
          "Import batch cancelled; completed objects retained.",
          "AbortError",
        );
      return result;
    },
    project_export: async (a, c) => {
      const s = host.snapshot(),
        entities =
          a.visible === false
            ? s.entities
            : s.entities.filter((e) => e.visible);
      let data: Blob | Uint8Array, name: string, mime: string;
      if (a.format === "project") {
        data = await encodeProjectFile(
          {
            projectId: s.projectId,
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
          },
          c.signal,
        );
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
    history_undo: (a, c) => {
      c.check();
      if (a.scope === "sketch") {
        if (!host.stepSketchHistory)
          throw new Error("Sketch history is unavailable.");
        return { updated: host.stepSketchHistory(false), scope: "sketch" };
      }
      host.undo();
      return { updated: true };
    },
    history_redo: (a, c) => {
      c.check();
      if (a.scope === "sketch") {
        if (!host.stepSketchHistory)
          throw new Error("Sketch history is unavailable.");
        return { updated: host.stepSketchHistory(true), scope: "sketch" };
      }
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
  return operations;
}
