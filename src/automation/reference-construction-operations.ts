import type { Handler, WorkspaceHost } from "./api";
import {
  copyReferenceConstruction,
  type ReferenceConstructionDefinition,
} from "../reference-construction";
import { validateReferenceEntity } from "../reference-entity";
import { setNativeReferenceLineEndpoints } from "../reference-line-evaluation";
import type { ReferenceConstructionState } from "../reference-construction-evaluation";
import {
  createReferencePointSeed,
  referenceMidpointDefinition,
  evaluateReferenceMidpoint,
  REFERENCE_MIDPOINT_LIMIT,
} from "../reference-midpoint";
import { resolveStoredReferenceConstructionInputs } from "../reference-construction-resolver";
import { referenceGeometrySceneBounds } from "../reference-scene-bounds";
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
    { sessionId: string; value: ReferenceConstructionApplyTarget } | undefined;
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
      geometry: state.preview.geometry,
      outcome: state.preview.outcome,
      diagnostics: state.preview.diagnostics,
      target: target?.sessionId === state.sessionId ? target.value : undefined,
    };
  };
  return {
    reference_construction_get: inspect,
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
        if (!state.active || target?.sessionId !== state.sessionId)
          throw new Error("Reference session is no longer active.");
        const result = applyReferenceConstructionToWorkspace(host, context, {
          owner: state.sessionId,
          version: state.version,
          target: target.value,
        });
        target = undefined;
        return result;
      }
      if (args.kind !== "point" && args.kind !== "line")
        throw new Error("Preview requires point or line kind.");
      const midpoint = args.kind === "point" && args.mode === "midpoint";
      if (
        (args.mode !== undefined && !midpoint) ||
        (midpoint && args.position !== undefined) ||
        (!midpoint && args.sourceEntityId !== undefined)
      )
        throw new Error(
          "Midpoint mode requires a point and one source line, without numeric coordinates.",
        );
      if (
        (args.kind === "point" &&
          (args.start !== undefined || args.end !== undefined)) ||
        (args.kind === "line" && args.position !== undefined)
      )
        throw new Error(
          "Coordinates do not match the requested reference kind.",
        );
      if ((args.sessionId === undefined) !== (args.version === undefined))
        throw new Error(
          "Session identity and version must be supplied together.",
        );
      const captured =
        args.sessionId === undefined
          ? undefined
          : inspectReferenceConstructionPreview(host);
      const existing =
        args.entityId === undefined
          ? undefined
          : host
              .snapshot()
              .entities.find((entity) => entity.id === args.entityId);
      const previousDefinition = captured?.active
        ? captured.definition
        : existing
          ? validateReferenceEntity(existing)?.definition
          : undefined;
      const createsDestination =
        args.sessionId === undefined
          ? args.entityId === undefined
          : target !== undefined &&
            target.sessionId === args.sessionId &&
            target.value.kind === "create";
      if (
        midpoint &&
        createsDestination &&
        host.snapshot().entities.length >= REFERENCE_MIDPOINT_LIMIT
      )
        throw new Error(
          "Reference midpoint creation would exceed the scene limit.",
        );
      const definition = midpoint
        ? referenceMidpointDefinition(
            host.snapshot().entities,
            args.sourceEntityId,
          )
        : copyReferenceConstruction(
            args.kind === "point"
              ? {
                  version: 1,
                  kind: "point",
                  mode: "coordinates",
                  position: args.position,
                  sources: [],
                }
              : {
                  version: 1,
                  kind: "line",
                  mode: "endpoints",
                  start: args.start,
                  end: args.end,
                  records:
                    previousDefinition?.kind === "line"
                      ? previousDefinition.records
                      : [],
                  sources: [],
                },
          );
      // Authoring rejects unrepresentable display values before installing a preview.
      const prior = midpoint
        ? createReferencePointSeed()
        : numericState(definition);
      const resolvedInputs = midpoint
        ? resolveStoredReferenceConstructionInputs(
            host.snapshot().entities,
            definition,
          )
        : undefined;
      referenceGeometrySceneBounds(
        midpoint
          ? evaluateReferenceMidpoint(
              host.snapshot().entities,
              definition,
              prior,
            ).geometry
          : prior.geometry,
      );
      const edit = {
        definition,
        resolvedInputs,
        writeNumericInputs: !midpoint,
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
        editReferenceConstructionPreview(
          host,
          state.sessionId,
          args.version,
          edit,
        );
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
        target = { sessionId: state.sessionId, value: destination };
      }
      return inspect();
    },
  };
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
