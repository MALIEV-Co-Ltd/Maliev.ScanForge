import type { CommandContext, Handler, WorkspaceHost } from "./api";
import {
  createReferenceAcquisitionOperations,
  resolveReferenceAcquisitionJob,
} from "./reference-acquisition-operations";
import {
  copyReferenceConstruction,
  encodeReferenceConstruction,
  type ReferenceConstructionDefinition,
} from "../reference-construction";
import { validateReferenceEntity } from "../reference-entity";
import { referenceNumericEditFields } from "../reference-numeric-edit-fields";
import { setNativeReferenceLineEndpoints } from "../reference-line-evaluation";
import {
  evaluateReferenceConstruction,
  type ReferenceConstructionState,
} from "../reference-construction-evaluation";
import {
  createReferencePointSeed,
  referenceMidpointDefinition,
  isStoredReferenceLine,
  REFERENCE_MIDPOINT_LIMIT,
} from "../reference-midpoint";
import {
  resolveStoredReferenceConstructionInputs,
  resolveReferencePointSource,
  resolveReferenceLineSource,
} from "../reference-construction-resolver";
import { resolveConstructionIdentities } from "../reference-construction-identity";
import { datumEntityDependencies } from "../datum-dependencies";
import {
  buildReferencePointDefinition,
  buildReferenceLineDefinition,
  REFERENCE_CONSTRUCTION_LINE_RECORD_LIMIT,
} from "../reference-construction-lifecycle";
import type { Entity } from "../types";
import { objectPickable } from "../object-operations";
import {
  resolveReferenceCoordinatePoint,
  bakeNativeMillimetreFloatPick,
  roundTripNativePickedCoordinate,
} from "../reference-pick-coordinates";
import { referenceGeometrySceneBounds } from "../reference-scene-bounds";
import {
  copyReferenceGeometry,
  encodeReferenceGeometry,
} from "../reference-construction-values";
import {
  applyReferenceConstructionToWorkspace,
  type ReferenceConstructionApplyTarget,
} from "./reference-construction-apply";
import {
  beginReferenceConstructionPreview,
  editReferenceConstructionPreview,
  inspectReferenceConstructionPreview,
  releaseReferenceConstructionPreview,
} from "./reference-construction-preview";

/** Typed construction uses the same preview, mutation and history boundary in both editors. */
export function createReferenceConstructionOperations(
  host: WorkspaceHost,
): Record<string, Handler> {
  let target:
    | {
        sessionId: string;
        version: number;
        value: ReferenceConstructionApplyTarget;
        evaluationPrior: ReferenceConstructionState;
      }
    | undefined;
  const inspect = () => {
    const state = inspectReferenceConstructionPreview(host);
    if (!state.active) return state;
    return {
      active: true,
      sessionId: state.sessionId,
      version: state.version,
      expiresAt: state.expiresAt,
      units: "mm",
      definition: state.definition,
      definitionEncoding: encodeReferenceConstruction(state.definition),
      geometry: state.preview.geometry,
      geometryEncoding: encodeReferenceGeometry(state.preview.geometry),
      outcome: state.preview.outcome,
      diagnostics: state.preview.diagnostics,
      target: target?.sessionId === state.sessionId ? target.value : undefined,
    };
  };
  return {
    ...createReferenceAcquisitionOperations(host),
    reference_construction_get: inspect,
    reference_construction_pick: (args, context) => {
      context.check();
      const position = resolveCoordinatePick(host.snapshot().entities, {
        entityId: args.entityId,
        pointIndex: args.pointIndex,
      });
      context.check();
      return {
        entityId: args.entityId,
        pointIndex: args.pointIndex,
        position,
        positionEncoding: encodeReferenceGeometry({ kind: "point", position }),
        units: "mm",
        coordinateSpace: "world",
        acquisition: "point-cloud-vertex",
        numericOnly: true,
        sourceDependencyRetained: false,
      };
    },
    reference_construction_sources: (args, context) => {
      context.check();
      const scene = host.snapshot().entities;
      if (scene.length > REFERENCE_MIDPOINT_LIMIT)
        throw new Error(
          "Reference construction source-query scene limit exceeded.",
        );
      const kind = args.kind as "point" | "line";
      const mode = args.mode as SourceMode;
      if (
        kind === "line"
          ? !["pair", "average"].includes(mode)
          : !["midpoint", "center", "pair", "threePlanes"].includes(mode)
      )
        throw new Error("Source-query mode does not match its reference kind.");
      const forbidden = cycleSources(scene, args.entityId, context.check);
      // Resolve all keys once without publishing provisional assignments.
      const keys = new Map(
        resolveConstructionIdentities(
          scene,
          scene.map((row) => row.id),
        ).orderedSources.map((row) => [row.id, row.constructionOrderKey]),
      );
      const offset = (args.offset as number | undefined) ?? 0;
      const limit = (args.limit as number | undefined) ?? 50;
      const sources = scene.slice(offset, offset + limit).map((entity) => {
        context.check();
        const eligibility = sourceEligibility(entity, mode, kind);
        return {
          entityId: entity.id,
          name: entity.name,
          kind: entity.kind,
          ...eligibility,
          ...(forbidden.has(entity.id)
            ? {
                eligible: false,
                reason: "Source would create a reference dependency cycle.",
              }
            : {}),
          constructionOrderKey: keys.get(entity.id),
          identityStatus:
            entity.constructionOrderKey === undefined ? "provisional" : "saved",
        };
      });
      context.check();
      return {
        units: "mm",
        coordinateSpace: "world",
        total: scene.length,
        nextOffset:
          offset + sources.length < scene.length
            ? offset + sources.length
            : null,
        sources,
      };
    },
    reference_construct: (args, context) => {
      context.check();
      const geometryFields = [
        "kind",
        "position",
        "start",
        "end",
        "entityId",
        "name",
        "mode",
        "sourceEntityId",
        "sourceEntityIds",
        "positionPick",
        "startPick",
        "endPick",
        "sourcePicks",
        "initialize",
      ];
      if (
        args.action !== "preview" &&
        geometryFields.some((key) => args[key] !== undefined)
      )
        throw new Error(
          "Apply and Cancel accept only the captured session identity and version.",
        );
      if (args.action !== "preview") {
        const state = inspectReferenceConstructionPreview(host);
        if (
          !("sessionId" in state) ||
          state.sessionId !== args.sessionId ||
          state.version !== args.version
        )
          throw new Error(
            "Reference session or version changed; inspect reference_construction_get.",
          );
        if (args.action === "cancel") {
          releaseReferenceConstructionPreview(host, state.sessionId);
          target = undefined;
          return { cancelled: true };
        }
        if (
          !state.active ||
          target?.sessionId !== state.sessionId ||
          target.version !== state.version
        )
          throw new Error("Reference session is no longer active.");
        const result = applyReferenceConstructionToWorkspace(host, context, {
          owner: state.sessionId,
          version: state.version,
          target: target.value,
          evaluationPrior: target.evaluationPrior,
        });
        target = undefined;
        return result;
      }
      if (args.kind !== "point" && args.kind !== "line")
        throw new Error("Preview requires point or line kind.");
      const initialize = args.initialize === true;
      if (
        initialize &&
        [
          "position",
          "start",
          "end",
          "positionPick",
          "startPick",
          "endPick",
          "mode",
          "sourceEntityId",
          "sourceEntityIds",
          "sourcePicks",
        ].some((field) => args[field] !== undefined)
      )
        throw new Error(
          "Initialize is exclusive with numeric, pick, mode and source replacements.",
        );
      const midpoint = args.kind === "point" && args.mode === "midpoint";
      const derivedPoint =
        args.kind === "point" &&
        ["center", "pair", "threePlanes"].includes(String(args.mode));
      const derivedLine =
        args.kind === "line" && ["pair", "average"].includes(String(args.mode));
      const derived = derivedPoint || derivedLine;
      const pickedPosition = args.positionPick !== undefined;
      const pickedStart = args.startPick !== undefined;
      const pickedEnd = args.endPick !== undefined;
      if (
        (args.mode !== undefined && !midpoint && !derived) ||
        ((midpoint || derived) &&
          (args.position !== undefined ||
            args.start !== undefined ||
            args.end !== undefined ||
            pickedPosition ||
            pickedStart ||
            pickedEnd)) ||
        (!midpoint && args.sourceEntityId !== undefined) ||
        (!derivedPoint && args.sourceEntityIds !== undefined) ||
        (derivedPoint && !Array.isArray(args.sourceEntityIds)) ||
        (!derivedLine && args.sourcePicks !== undefined)
      )
        throw new Error(
          "Source modes exclude numeric coordinates; midpoint uses sourceEntityId, derived points use sourceEntityIds, and derived lines use located sourcePicks or retained records.",
        );
      if (
        (args.kind === "point" &&
          (args.start !== undefined ||
            args.end !== undefined ||
            pickedStart ||
            pickedEnd)) ||
        (args.kind === "line" &&
          (args.position !== undefined || pickedPosition))
      )
        throw new Error(
          "Coordinates do not match the requested reference kind.",
        );
      if (
        (pickedPosition && args.position !== undefined) ||
        (pickedStart && args.start !== undefined) ||
        (pickedEnd && args.end !== undefined)
      )
        throw new Error(
          "Each coordinate field accepts either typed values or a pick intent, never both.",
        );
      if ((args.sessionId === undefined) !== (args.version === undefined))
        throw new Error(
          "Session identity and version must be supplied together.",
        );
      const captured =
        args.sessionId === undefined
          ? undefined
          : inspectReferenceConstructionPreview(host);
      if (
        args.sessionId !== undefined &&
        (!captured?.active ||
          captured.sessionId !== args.sessionId ||
          target?.sessionId !== captured.sessionId)
      )
        throw new Error(
          "Reference session changed; inspect reference_construction_get.",
        );
      const existing =
        args.entityId === undefined
          ? undefined
          : host
              .snapshot()
              .entities.find((entity) => entity.id === args.entityId);
      let previousDefinition = captured?.active
        ? captured.definition
        : existing
          ? validateReferenceEntity(existing)?.definition
          : undefined;
      const ownedEditId =
        target?.value.kind === "edit" ? target.value.id : undefined;
      const initializationTarget = initialize
        ? args.sessionId === undefined
          ? existing
          : ownedEditId !== undefined
            ? host
                .snapshot()
                .entities.find((entity) => entity.id === ownedEditId)
            : undefined
        : undefined;
      let initialized:
        ReturnType<typeof referenceNumericEditFields> | undefined;
      if (initialize) {
        if (!initializationTarget)
          throw new Error("Initialize requires an existing edit destination.");
        if (initializationTarget.locked)
          throw new Error("Reference edit destination is locked.");
        const data = validateReferenceEntity(initializationTarget);
        if (!data || data.geometry.kind !== args.kind)
          throw new Error(
            "Initialize requires an existing same-kind reference.",
          );
        if (
          data.definition.kind === "point"
            ? data.definition.mode !== "coordinates"
            : data.definition.mode !== "endpoints"
        )
          throw new Error(
            "Initialize supports numeric modes; derived recipes remain unchanged.",
          );
        initialized = referenceNumericEditFields(initializationTarget);
        previousDefinition = data.definition;
      }
      if (
        derivedLine &&
        !(captured?.active && captured.definition.kind === "line") &&
        existing?.kind !== "referenceLine"
      )
        throw new Error(
          "Derived lines require an existing line or an owned typed-line preview with explicit prior endpoints.",
        );
      const targetId =
        args.entityId ??
        (captured?.active && target?.value.kind === "edit"
          ? target.value.id
          : undefined);
      const createsDestination =
        args.sessionId === undefined
          ? args.entityId === undefined
          : target !== undefined &&
            target.sessionId === args.sessionId &&
            target.value.kind === "create";
      if (
        (midpoint || derived) &&
        createsDestination &&
        host.snapshot().entities.length >= REFERENCE_MIDPOINT_LIMIT
      )
        throw new Error(
          "Reference midpoint creation would exceed the scene limit.",
        );
      const scene = host.snapshot().entities;
      const position =
        initialized?.kind === "point"
          ? initialized.position
          : pickedPosition
            ? resolvePreviewCoordinatePick(host, context, args.positionPick)
            : args.position;
      const start =
        initialized?.kind === "line"
          ? initialized.start
          : pickedStart
            ? resolvePreviewCoordinatePick(host, context, args.startPick)
            : args.start;
      const end =
        initialized?.kind === "line"
          ? initialized.end
          : pickedEnd
            ? resolvePreviewCoordinatePick(host, context, args.endPick)
            : args.end;
      context.check();
      const definition = midpoint
        ? referenceMidpointDefinition(
            host.snapshot().entities,
            args.sourceEntityId,
          )
        : derivedPoint
          ? pointDefinition(
              host.snapshot().entities,
              args.mode as Exclude<PointSourceMode, "midpoint">,
              args.sourceEntityIds as string[],
              targetId,
              context.check,
            )
          : derivedLine
            ? lineDefinition(
                scene,
                args.mode as LineSourceMode,
                args.sourcePicks,
                previousDefinition,
                targetId,
                context.check,
              )
            : copyReferenceConstruction(
                args.kind === "point"
                  ? {
                      version: 1,
                      kind: "point",
                      mode: "coordinates",
                      position,
                      sources: [],
                    }
                  : {
                      version: 1,
                      kind: "line",
                      mode: "endpoints",
                      start,
                      end,
                      records:
                        previousDefinition?.kind === "line"
                          ? previousDefinition.records
                          : [],
                      sources: [],
                    },
              );
      // Authoring rejects unrepresentable display values before installing a preview.
      const prior: ReferenceConstructionState =
        midpoint || derived
          ? captured?.active
            ? captured.preview
            : existing?.reference
              ? {
                  geometry: existing.reference.geometry,
                  state: existing.reference.evaluation,
                }
              : createReferencePointSeed()
          : numericState(definition);
      const resolvedInputs =
        midpoint || derived
          ? resolveStoredReferenceConstructionInputs(
              host.snapshot().entities,
              definition,
            )
          : undefined;
      referenceGeometrySceneBounds(
        midpoint || derived
          ? evaluateReferenceConstruction(definition, resolvedInputs, prior)
              .geometry
          : prior.geometry,
      );
      const edit = {
        definition,
        resolvedInputs,
        writeNumericInputs: !midpoint && !derived,
        evaluationAllowed: true,
      };
      if (args.sessionId !== undefined) {
        const state = captured!;
        if (
          !state.active ||
          state.sessionId !== args.sessionId ||
          target?.sessionId !== state.sessionId
        )
          throw new Error(
            "Reference session changed; inspect reference_construction_get.",
          );
        if (state.definition.kind !== definition.kind)
          throw new Error("Reference edit cannot change its geometric kind.");
        if (args.entityId !== undefined || args.name !== undefined)
          throw new Error(
            "Set the reference destination only when beginning a preview.",
          );
        const updated = editReferenceConstructionPreview(
          host,
          state.sessionId,
          args.version,
          edit,
        );
        target = {
          ...target!,
          version: updated.version,
          evaluationPrior: copyState(prior),
        };
      } else {
        if (!host.showReferenceConstructionPreview)
          throw new Error("Reference construction display is unavailable.");
        if (args.entityId !== undefined && args.name !== undefined)
          throw new Error("Use object_update to rename an existing reference.");
        if (
          args.entityId !== undefined &&
          (!existing || existing.locked || !validateReferenceEntity(existing))
        )
          throw new Error(
            "Reference edit requires an existing unlocked reference.",
          );
        if (
          existing &&
          (existing.kind === "referencePoint" ? "point" : "line") !==
            definition.kind
        )
          throw new Error("Reference edit cannot change its geometric kind.");
        const destination: ReferenceConstructionApplyTarget = existing
          ? { kind: "edit", id: existing.id }
          : {
              kind: "create",
              id: crypto.randomUUID(),
              name: args.name ?? `Reference ${definition.kind}`,
              color: "#ffbb44",
              opacity: 1,
            };
        const state = beginReferenceConstructionPreview(
          host,
          {
            show: (owner, candidate) =>
              host.showReferenceConstructionPreview!(owner, candidate),
            clear: (owner) =>
              host.showReferenceConstructionPreview!(owner, null),
          },
          existing
            ? {
                geometry: existing.reference!.geometry,
                state: existing.reference!.evaluation,
              }
            : prior,
          edit,
        );
        target = {
          sessionId: state.sessionId,
          version: state.version,
          value: destination,
          evaluationPrior: copyState(prior),
        };
      }
      return inspect();
    },
  };
}

type PointSourceMode = "midpoint" | "center" | "pair" | "threePlanes";
type LineSourceMode = "pair" | "average";
type SourceMode = PointSourceMode | LineSourceMode;

function copyState(
  state: ReferenceConstructionState,
): ReferenceConstructionState {
  return {
    geometry: copyReferenceGeometry(state.geometry),
    state: { ...state.state },
  };
}

/** Shared by read-only acquisition and lossless Preview intents; no caller-authored coordinates. */
function resolvePreviewCoordinatePick(
  host: WorkspaceHost,
  context: CommandContext,
  input: unknown,
) {
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    "acquisitionJobId" in input
  ) {
    if (
      Reflect.ownKeys(input).length !== 1 ||
      typeof input.acquisitionJobId !== "string"
    )
      throw new Error("Acquisition pick accepts only acquisitionJobId.");
    return resolveReferenceAcquisitionJob(
      host,
      context,
      input.acquisitionJobId,
    );
  }
  return resolveCoordinatePick(host.snapshot().entities, input);
}

function resolveCoordinatePick(scene: readonly Entity[], input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error(
      "Coordinate pick requires a source entity and point index.",
    );
  const pick = input as Record<string, unknown>;
  const fields = Reflect.ownKeys(pick);
  if (
    fields.length !== 2 ||
    fields.some((key) => key !== "entityId" && key !== "pointIndex") ||
    typeof pick.entityId !== "string" ||
    typeof pick.pointIndex !== "number"
  )
    throw new Error("Coordinate pick accepts only entityId and pointIndex.");
  const matches = scene.filter((entity) => entity.id === pick.entityId);
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? "Coordinate pick requires a unique source identity."
        : "Coordinate pick source does not exist.",
    );
  const source = matches[0];
  if (source.kind !== "pointcloud")
    throw new Error(
      "Coordinate picking currently supports point-cloud vertices only.",
    );
  if (!source.visible || !objectPickable(source))
    throw new Error(
      "Coordinate pick requires a visible, unlocked, selectable source cloud.",
    );
  return bakeNativeMillimetreFloatPick(
    resolveReferenceCoordinatePoint(scene, source.id, pick.pointIndex),
  ).map(roundTripNativePickedCoordinate) as [number, number, number];
}

/** One eligibility policy for public discovery and mutation, also consumed by GUI selectors. */
function sourceEligibility(
  entity: Entity,
  mode: SourceMode,
  kind: "point" | "line" = "point",
): {
  primitiveKind: string;
  eligible: boolean;
  reason?: string;
  planeUVBounds?: { min: number[]; max: number[]; units: "mm" };
} {
  if (kind === "line") {
    try {
      const primitive = resolveReferenceLineSource(
        entity,
        mode as LineSourceMode,
      );
      return {
        primitiveKind: primitive.kind,
        eligible: true,
        ...(primitive.kind === "plane"
          ? {
              planeUVBounds: {
                min: primitive.directPlaneHalfSizes!.map((size) => -size),
                max: [...primitive.directPlaneHalfSizes!],
                units: "mm",
              },
            }
          : {}),
      };
    } catch (error) {
      return {
        primitiveKind: "unsupported",
        eligible: false,
        reason:
          error instanceof Error ? error.message : "Unsupported line source.",
      };
    }
  }
  if (mode === "midpoint")
    return {
      primitiveKind: entity.kind === "referenceLine" ? "axis" : "unsupported",
      eligible: isStoredReferenceLine(entity),
      ...(isStoredReferenceLine(entity)
        ? {}
        : { reason: "Midpoint requires a stored semantic endpoints line." }),
    };
  try {
    const primitive = resolveReferencePointSource(entity);
    const eligible =
      mode === "threePlanes"
        ? primitive.kind === "plane"
        : primitive.kind !== "unavailable";
    return {
      primitiveKind: primitive.kind,
      eligible,
      ...(eligible
        ? {}
        : { reason: `Unsupported source geometry for point ${mode}.` }),
    };
  } catch (error) {
    return {
      primitiveKind: "unsupported",
      eligible: false,
      reason:
        error instanceof Error
          ? error.message
          : "Unsupported reference source family.",
    };
  }
}

function cycleSources(
  scene: readonly Entity[],
  targetId: unknown,
  check: () => void,
): Set<string> {
  if (targetId === undefined) return new Set();
  if (typeof targetId !== "string" || !scene.some((row) => row.id === targetId))
    throw new Error("Reference edit source-query target is missing.");
  const reverse = new Map<string, string[]>();
  for (const row of datumEntityDependencies(scene)) {
    check();
    for (const id of row.references) {
      const children = reverse.get(id) ?? [];
      children.push(row.id);
      reverse.set(id, children);
    }
  }
  const forbidden = new Set([targetId]),
    pending = [targetId];
  for (let index = 0; index < pending.length; index++) {
    check();
    for (const child of reverse.get(pending[index]) ?? [])
      if (!forbidden.has(child)) {
        forbidden.add(child);
        pending.push(child);
      }
  }
  return forbidden;
}

function pointDefinition(
  scene: readonly Entity[],
  mode: Exclude<PointSourceMode, "midpoint">,
  sourceIds: readonly string[],
  targetId: unknown,
  check: () => void,
): ReferenceConstructionDefinition {
  const forbidden = cycleSources(scene, targetId, check);
  const byId = new Map(scene.map((entity) => [entity.id, entity]));
  for (const id of sourceIds) {
    check();
    if (forbidden.has(id))
      throw new Error(
        "A reference cannot depend on itself or create a dependency cycle.",
      );
    const source = byId.get(id);
    if (!source)
      throw new Error("Missing reference construction source: " + id);
    const eligibility = sourceEligibility(source, mode);
    if (!eligibility.eligible)
      throw new Error(
        eligibility.reason ?? "Unsupported reference source family.",
      );
  }
  return buildReferencePointDefinition(scene, mode, sourceIds).definition;
}

function lineDefinition(
  scene: readonly Entity[],
  mode: LineSourceMode,
  picks: unknown,
  previous: ReferenceConstructionDefinition | undefined,
  targetId: unknown,
  check: () => void,
): ReferenceConstructionDefinition {
  if (scene.length > REFERENCE_MIDPOINT_LIMIT)
    throw new Error("Reference construction scene limit exceeded.");
  const forbidden = cycleSources(scene, targetId, check);
  let definition: ReferenceConstructionDefinition;
  if (picks !== undefined) {
    if (!Array.isArray(picks))
      throw new Error(
        "Line sourcePicks must be an ordered located-source array.",
      );
    for (const pick of picks) {
      check();
      if (forbidden.has(pick?.entityId))
        throw new Error(
          "A reference cannot depend on itself or create a dependency cycle.",
        );
    }
    definition = buildReferenceLineDefinition(scene, mode, picks).definition;
  } else {
    if (previous?.kind !== "line" || previous.records.length === 0)
      throw new Error(
        "Derived lines require located source picks or retained line records.",
      );
    if (previous.records.length > REFERENCE_CONSTRUCTION_LINE_RECORD_LIMIT)
      throw new Error("Reference line record resource limit exceeded.");
    definition = copyReferenceConstruction({
      version: 1,
      kind: "line",
      mode,
      records: previous.records,
      sources:
        previous.mode === "endpoints"
          ? resolveConstructionIdentities(
              scene,
              previous.records.map((record) => record.entityId),
            ).orderedSources
          : previous.sources,
    });
  }
  const byId = new Map(scene.map((entity) => [entity.id, entity]));
  for (const source of definition.sources) {
    check();
    if (forbidden.has(source.id))
      throw new Error(
        "A reference cannot depend on itself or create a dependency cycle.",
      );
    const entity = byId.get(source.id);
    if (!entity)
      throw new Error("Missing reference construction source: " + source.id);
    resolveReferenceLineSource(entity, mode);
  }
  return definition;
}

function numericState(
  definition: ReferenceConstructionDefinition,
): ReferenceConstructionState {
  if (definition.kind === "point" && definition.mode === "coordinates")
    return {
      geometry: { kind: "point", position: definition.position },
      state: { completionWord: 256 },
    };
  if (definition.kind !== "line" || definition.mode !== "endpoints")
    throw new Error("Unsupported numeric reference mode.");
  const result = setNativeReferenceLineEndpoints(
    { kind: "line", start: [0, 0, 0], direction: [0, 0, 0], length: 0 },
    definition.start,
    definition.end,
    "typed",
  );
  if (!result.written)
    throw new Error("Reference endpoints must define a nonzero finite line.");
  return { geometry: result.geometry, state: { completionWord: 256 } };
}
