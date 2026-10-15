import type { Entity, IndexedMesh, Vec3 } from "./types";
import type { ProcessingResult } from "./processing-client";
import { rotatePointNormals } from "./point-cloud";
import { indexedRenderNormals } from "./indexed-mesh";
import { nativeSurfaceRefinementRequest } from "./native-surface-refinement";
import { publishedLandmarkRoots } from "./native-landmark-roots";

export interface LandmarkAlignment {
  moving: Entity;
  fixed?: Entity;
  pickScene?: readonly Entity[];
  picks: { entityId: string; point: Vec3 }[];
  preview?: ProcessingResult;
  targetScope?: LandmarkTargetScope;
  refinementScene?: readonly Entity[];
}
export type LandmarkTargetScope = "visibleScene" | "fixed";

export function landmarkReferenceEntities(session: LandmarkAlignment) {
  return (session.pickScene ?? (session.fixed ? [session.fixed] : [])).filter(
    (entity) =>
      entity.id !== session.moving.id &&
      entity.visible &&
      !entity.locked &&
      entity.selectable !== false,
  );
}

/** Original CPU target order: visible CAD providers before other visible scans. */
export function visibleLandmarkTargets(
  moving: Entity,
  scene: readonly Entity[],
) {
  const roots = new Set(publishedLandmarkRoots(scene));
  const visible = scene.filter(
    (entity) => entity.id !== moving.id && entity.visible,
  );
  return [
    ...visible.filter((entity) => !!entity.kernelId && roots.has(entity.id)),
    ...visible.filter(
      (entity) =>
        entity.kind === "mesh" &&
        !!entity.indexedMesh &&
        !entity.kernelId &&
        !entity.parametric &&
        !entity.surfacePatch,
    ),
  ];
}
export function landmarkTargetEntities(session: LandmarkAlignment) {
  return session.targetScope === "visibleScene"
    ? visibleLandmarkTargets(
        session.moving,
        session.refinementScene ?? (session.fixed ? [session.fixed] : []),
      )
    : session.fixed && (session.fixed.indexedMesh || session.fixed.kernelId)
      ? [session.fixed]
      : [];
}
export interface LandmarkPreviewOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number, stage: string) => void;
  check?: () => void;
  workerCount?: number;
  parallel?: boolean;
}
export function beginLandmarkAlignment(
  moving: Entity,
  fixed?: Entity,
  options: {
    targetScope?: LandmarkTargetScope;
    scene?: readonly Entity[];
  } = {},
): LandmarkAlignment {
  if (
    moving.id === fixed?.id ||
    (moving.kind !== "mesh" && moving.kind !== "pointcloud") ||
    moving.kernelId ||
    moving.parametric ||
    moving.surfacePatch
  )
    throw new Error("Choose a moving scan and a different fixed object.");
  const targetScope = options.targetScope ?? "visibleScene";
  if (targetScope !== "visibleScene" && targetScope !== "fixed")
    throw new Error("Choose visibleScene or fixed target scope.");
  if (targetScope === "fixed" && !fixed)
    throw new Error("Choose a fixed reference for fixed-only refinement.");
  return {
    moving,
    fixed,
    pickScene: [...(options.scene ?? [moving, ...(fixed ? [fixed] : [])])],
    picks: [],
    targetScope,
    refinementScene:
      options.scene && targetScope === "visibleScene"
        ? [...options.scene]
        : undefined,
  };
}
export function pickLandmark(
  session: LandmarkAlignment,
  entityId: string,
  point: Vec3,
): LandmarkAlignment {
  if (session.preview)
    throw new Error("Reset the alignment preview before picking more points.");
  const references = landmarkReferenceEntities(session);
  if (
    entityId !== session.moving.id &&
    !references.some(
      (entity) =>
        entity.id === entityId &&
        entity.visible &&
        !entity.locked &&
        entity.selectable !== false,
    )
  )
    throw new Error("Pick a point on the moving scan or the fixed target.");
  if (point.length !== 3 || !point.every(Number.isFinite))
    throw new Error("Landmarks must contain finite world coordinates.");
  // Native viewport picks arrive as Float32 and are widened into double records.
  const picked: Vec3 = [
    Math.fround(point[0]),
    Math.fround(point[1]),
    Math.fround(point[2]),
  ];
  if (!picked.every(Number.isFinite))
    throw new Error("Landmarks exceed the native Float32 coordinate range.");
  return {
    ...session,
    preview: undefined,
    picks: [...session.picks, { entityId, point: picked }],
  };
}
export function landmarkPairs(session: LandmarkAlignment) {
  return {
    moving: session.picks
      .filter((p) => p.entityId === session.moving.id)
      .map((p) => p.point),
    fixed: session.picks
      .filter((p) => p.entityId !== session.moving.id)
      .map((p) => p.point),
  };
}
export function landmarkRequest(
  session: LandmarkAlignment,
  workerCount = 2,
  parallel = true,
  includeRefinement = true,
) {
  const pairs = landmarkPairs(session);
  const targets = landmarkTargetEntities(session);
  if (pairs.moving.length < 3 || pairs.moving.length !== pairs.fixed.length)
    throw new Error(
      "Pick at least three corresponding points on each object in the same order.",
    );
  return {
    kind: "paired" as const,
    positions: session.moving.positions,
    sourceIndexed:
      session.moving.kind === "mesh" ? session.moving.indexedMesh : undefined,
    sourceLandmarks: pairs.moving.flat(),
    targetLandmarks: pairs.fixed.flat(),
    ...(includeRefinement &&
    session.moving.indexedMesh &&
    targets.every((target) => !!target.indexedMesh && !target.kernelId)
      ? landmarkRefinementTargets(
          session.moving,
          targets,
          workerCount,
          parallel,
        )
      : {}),
  };
}

/** Shared GUI/MCP acquisition of immutable CAD-backed fixed target records. */
export async function prepareLandmarkRefinementTargets(
  source: Entity,
  targets: readonly Entity[],
  acquireCad: (kernelId: string) => Promise<IndexedMesh>,
  workerCount = 2,
  parallel = true,
  options: Pick<LandmarkPreviewOptions, "signal" | "check"> = {},
) {
  const check = () => {
    options.signal?.throwIfAborted();
    options.check?.();
  };
  check();
  if (
    source.kind !== "mesh" ||
    !source.indexedMesh ||
    source.kernelId ||
    source.parametric ||
    source.surfacePatch
  )
    throw new Error(
      "Choose a raw indexed moving scan for point-pair refinement.",
    );
  const resolved: Entity[] = [];
  for (const target of targets) {
    check();
    if (!target.kernelId) {
      resolved.push(target);
      continue;
    }
    const indexedMesh = await acquireCad(target.kernelId);
    check();
    const positions = new Float32Array(indexedMesh.triangles.length * 3);
    for (let index = 0; index < indexedMesh.triangles.length; index++) {
      if (index % 4096 === 0) check();
      const id = indexedMesh.triangles[index];
      if (
        !Number.isInteger(id) ||
        id < 0 ||
        id * 3 + 2 >= indexedMesh.vertices.length
      )
        throw new Error("CAD alignment triangle references a missing vertex.");
      for (let axis = 0; axis < 3; axis++)
        positions[index * 3 + axis] = indexedMesh.vertices[id * 3 + axis];
    }
    resolved.push({
      ...target,
      kind: "mesh",
      kernelId: undefined,
      parametric: undefined,
      surfacePatch: undefined,
      positions,
      indexedMesh,
    });
  }
  return landmarkRefinementTargets(source, resolved, workerCount, parallel);
}

export async function prepareLandmarkRequest(
  session: LandmarkAlignment,
  acquireCad: (kernelId: string) => Promise<IndexedMesh>,
  options: LandmarkPreviewOptions = {},
) {
  const workers = options.workerCount ?? 2,
    parallel = options.parallel ?? true;
  const request = landmarkRequest(session, workers, parallel, false);
  const targets = landmarkTargetEntities(session);
  if (
    session.moving.indexedMesh &&
    targets.every((target) => !!target.indexedMesh || !!target.kernelId)
  )
    Object.assign(
      request,
      await prepareLandmarkRefinementTargets(
        session.moving,
        targets,
        acquireCad,
        workers,
        parallel,
        options,
      ),
    );
  return request;
}
/** Shared GUI/agent indexed target validation for point-pair refinement. */
export function landmarkRefinementTargets(
  source: Entity,
  targets: readonly Entity[],
  workerCount = 2,
  parallel = true,
) {
  if (
    [source, ...targets].some(
      (entity) => entity.kernelId || entity.parametric || entity.surfacePatch,
    )
  )
    throw new Error(
      "Point-pair refinement currently requires raw indexed scan meshes.",
    );
  if (!targets.length) {
    if (source.kind !== "mesh" || !source.indexedMesh)
      throw new Error(
        "Point-pair refinement requires a raw indexed moving scan.",
      );
    if (source.meshSelection?.hidden?.length)
      throw new Error("Reveal hidden triangles before surface refinement.");
    return { refinementTargets: [], workerCount, parallel };
  }
  const request = nativeSurfaceRefinementRequest(
    source,
    targets,
    1,
    3,
    undefined,
    workerCount,
    parallel,
  );
  return {
    refinementTargets: targets.map((target) => ({
      positions: target.positions,
      indexedMesh: target.indexedMesh!,
    })),
    workerCount: request.workerCount,
    parallel: request.parallel,
  };
}
export function landmarkSceneUnchanged(
  session: LandmarkAlignment,
  entities: Entity[],
) {
  const sameGeometry = (original: Entity, current: Entity | undefined) =>
    !!current &&
    current.positions === original.positions &&
    current.indexedMesh === original.indexedMesh &&
    current.normals === original.normals &&
    current.kind === original.kind &&
    current.kernelId === original.kernelId &&
    current.parametric === original.parametric &&
    current.surfacePatch === original.surfacePatch &&
    current.visible === original.visible &&
    current.meshSelection === original.meshSelection;
  if (
    session.targetScope === "visibleScene" &&
    session.refinementScene &&
    session.moving.indexedMesh
  ) {
    const before = landmarkTargetEntities(session),
      after = visibleLandmarkTargets(session.moving, entities);
    if (
      before.length !== after.length ||
      before.some(
        (entity, index) =>
          entity.id !== after[index].id || !sameGeometry(entity, after[index]),
      )
    )
      return false;
  }
  const originals = [session.moving, ...(session.fixed ? [session.fixed] : [])];
  for (const pick of session.picks) {
    if (originals.some((entity) => entity.id === pick.entityId)) continue;
    const reference = session.pickScene?.find(
      (entity) => entity.id === pick.entityId,
    );
    if (!reference) return false;
    originals.push(reference);
  }
  return originals.every((original) => {
    const current = entities.find((entity) => entity.id === original.id);
    return current && !current.locked && sameGeometry(original, current);
  });
}
export function acceptLandmarkAlignment(
  session: LandmarkAlignment,
  entities: Entity[],
): Entity[] {
  if (
    !session.preview?.positions ||
    !session.preview.registration ||
    !landmarkSceneUnchanged(session, entities)
  )
    throw new Error(
      "Preview alignment again before accepting; the scene or landmarks changed.",
    );
  if (session.preview.positions.length !== session.moving.positions.length)
    throw new Error("Alignment preview does not match the moving scan.");
  return entities.map((e) =>
    e.id === session.moving.id
      ? (session.preview!.cloudPreview ?? {
          ...e,
          positions: session.preview!.positions!,
          indexedMesh: session.preview!.indexedMesh,
          normals: session.preview!.indexedMesh?.normals
            ? indexedRenderNormals(session.preview!.indexedMesh)
            : e.normals
              ? rotatePointNormals(
                  e.normals,
                  session.preview!.registration!.transform.rotation,
                )
              : undefined,
          fit: undefined,
        })
      : e,
  );
}
export function landmarkMarkers(session: LandmarkAlignment) {
  let moving = 0,
    fixed = 0;
  return session.picks.map((p) => ({
    point:
      p.entityId === session.moving.id && session.preview?.registration
        ? (() => {
            const { rotation: r, translation: t } =
              session.preview!.registration!.transform;
            const [x, y, z] = p.point;
            return [
              y * r[1] + x * r[0] + z * r[2] + t[0],
              y * r[4] + x * r[3] + z * r[5] + t[1],
              y * r[7] + x * r[6] + z * r[8] + t[2],
            ] as Vec3;
          })()
        : p.point,
    label: p.entityId === session.moving.id ? `M${++moving}` : `F${++fixed}`,
  }));
}

export interface LandmarkEdit {
  action:
    | "pick"
    | "remove-last"
    | "clear"
    | "reset"
    | "target-scope"
    | "reference-target";
  fixedId?: string;
  entityId?: string;
  point?: Vec3;
  targetScope?: LandmarkTargetScope;
}
/** Original preview state guards, shared by the canvas, dialog and agent API. */
export function editLandmarks(
  session: LandmarkAlignment,
  edit: LandmarkEdit,
  scene?: readonly Entity[],
): LandmarkAlignment {
  if (edit.action === "reference-target") {
    const references = scene ?? session.pickScene ?? [];
    const fixed = edit.fixedId
      ? references.find((entity) => entity.id === edit.fixedId)
      : undefined;
    if (
      edit.fixedId &&
      (!fixed || !fixed.visible || fixed.locked || fixed.selectable === false)
    )
      throw new Error("Choose an existing visible unlocked fixed reference.");
    return beginLandmarkAlignment(session.moving, fixed, {
      targetScope: fixed ? session.targetScope : "visibleScene",
      scene: references,
    });
  }
  if (edit.action === "target-scope") {
    if (!edit.targetScope)
      throw new Error("Supply targetScope to change refinement targets.");
    return {
      ...beginLandmarkAlignment(session.moving, session.fixed, {
        targetScope: edit.targetScope,
        scene: scene ?? session.refinementScene,
      }),
      picks: session.picks,
      pickScene: session.pickScene,
    };
  }
  if (edit.action === "reset") return { ...session, preview: undefined };
  if (edit.action === "pick") {
    if (!edit.entityId || !edit.point)
      throw new Error("Supply entityId and point to pick a landmark.");
    return pickLandmark(session, edit.entityId, edit.point);
  }
  if (session.preview) return session;
  return {
    ...session,
    picks: edit.action === "clear" ? [] : session.picks.slice(0, -1),
  };
}
export function landmarkState(session: LandmarkAlignment | null) {
  return session
    ? {
        active: true,
        movingId: session.moving.id,
        fixedId: session.fixed?.id ?? null,
        referenceIds: landmarkReferenceEntities(session).map(
          (entity) => entity.id,
        ),
        targetScope: session.targetScope ?? "fixed",
        refinementTargetIds: session.moving.indexedMesh
          ? landmarkTargetEntities(session).map((entity) => entity.id)
          : [],
        preview: !!session.preview,
        ...(session.preview
          ? {
              registration: session.preview.registration,
              refinement: session.preview.refinement,
              diagnostics: session.preview.diagnostics,
              ...(session.preview.cloudPreview
                ? {
                    pointCloudPose:
                      session.preview.cloudPreview.pointCloudPlacement
                        ?.matrixBits,
                  }
                : {}),
              selectedTriangles: session.preview.diagnostics.selectedTriangles,
            }
          : {}),
        picks: session.picks,
        markers: landmarkMarkers(session),
      }
    : { active: false, preview: false };
}
