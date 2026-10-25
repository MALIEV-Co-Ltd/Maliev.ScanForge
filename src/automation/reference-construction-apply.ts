import type { CommandContext, WorkspaceHost } from "./api";
import type { Entity } from "../types";
import { applyReferenceConstructionPreview } from "./reference-construction-preview";
import { resolveConstructionIdentities } from "../reference-construction-identity";
import {
  copyReferenceEntityData,
  validateReferenceEntity,
} from "../reference-entity";
import { lockedObjectEdit } from "../object-operations";
import {
  evaluateReferenceMidpoint,
  refreshReferenceMidpoints,
  REFERENCE_MIDPOINT_LIMIT,
} from "../reference-midpoint";

export type ReferenceConstructionApplyTarget =
  | {
      readonly kind: "create";
      readonly id: string;
      readonly name: string;
      readonly color: string;
      readonly opacity: number;
    }
  | { readonly kind: "edit"; readonly id: string };

/** Internal cached publication; public source admission/editor/discovery remain gated. */
export function applyReferenceConstructionToWorkspace(
  host: WorkspaceHost,
  context: CommandContext,
  request: {
    readonly owner: string;
    readonly version: number;
    readonly target: ReferenceConstructionApplyTarget;
  },
) {
  context.check();
  if (!context.mutate)
    throw new Error("Reference Apply requires the shared mutation context.");
  const mutate = context.mutate;
  const target = request.target;
  if (
    !target ||
    typeof target.id !== "string" ||
    !["create", "edit"].includes(target.kind)
  )
    throw new Error("Invalid reference Apply target.");
  if (
    target.kind === "create" &&
    (typeof target.name !== "string" ||
      typeof target.color !== "string" ||
      !/^#[0-9a-fA-F]{6}$/.test(target.color) ||
      !Number.isFinite(target.opacity) ||
      target.opacity < 0 ||
      target.opacity > 1)
  )
    throw new Error("Invalid reference presentation metadata.");
  let publication:
    | {
        entityId: string;
        assignedSources: { id: string; constructionOrderKey: string }[];
        refreshedEntityIds: string[];
      }
    | undefined;
  const result = applyReferenceConstructionPreview(
    host,
    request.owner,
    request.version,
    (candidate) => {
      context.check();
      const midpoint =
        candidate.definition.kind === "point" &&
        candidate.definition.mode === "center" &&
        candidate.definition.sources.length === 1;
      if (
        candidate.definition.mode !== "coordinates" &&
        candidate.definition.mode !== "endpoints" &&
        !midpoint
      )
        throw new Error(
          "Derived reference acceptance requires source-specific finalization.",
        );
      const snapshot = host.snapshot();
      const existing = snapshot.entities.find(
        (entity) => entity.id === target.id,
      );
      if (target.kind === "create" && existing)
        throw new Error("Reference destination already exists.");
      if (
        midpoint &&
        target.kind === "create" &&
        snapshot.entities.length >= REFERENCE_MIDPOINT_LIMIT
      )
        throw new Error(
          "Reference midpoint creation would exceed the scene limit.",
        );
      if (target.kind === "edit") {
        if (!existing || existing.locked || !validateReferenceEntity(existing))
          throw new Error(
            "Reference edit requires an existing unlocked reference.",
          );
        if (
          (existing.kind === "referencePoint" ? "point" : "line") !==
          candidate.preview.geometry.kind
        )
          throw new Error("Reference edit cannot change its geometric kind.");
      }
      if (
        candidate.definition.sources.some((source) => source.id === target.id)
      )
        throw new Error("A reference cannot depend on itself.");
      const identities = resolveConstructionIdentities(
        snapshot.entities,
        candidate.definition.sources.map((source) => source.id),
      );
      if (
        JSON.stringify(identities.orderedSources) !==
        JSON.stringify(candidate.definition.sources)
      )
        throw new Error("Reference source identity binding changed.");
      const reference = copyReferenceEntityData({
        version: 1,
        definition: midpoint
          ? candidate.definition
          : { ...candidate.definition, sources: [] },
        geometry: candidate.preview.geometry,
        evaluation: { completionWord: 0x100 },
      });
      if (midpoint) {
        if (
          candidate.preview.outcome !== "updated" ||
          candidate.preview.diagnostics.reason !== "center"
        )
          throw new Error("Only a successful midpoint preview can be applied.");
        const finalized = evaluateReferenceMidpoint(
          snapshot.entities,
          reference.definition,
          { geometry: reference.geometry, state: { completionWord: 1 } },
        );
        if (
          reference.geometry.kind !== "point" ||
          finalized.geometry.kind !== "point" ||
          !reference.geometry.position.every((value, index) =>
            Object.is(
              value,
              finalized.geometry.kind === "point"
                ? finalized.geometry.position[index]
                : undefined,
            ),
          )
        )
          throw new Error(
            "Reference midpoint no longer matches the cached preview.",
          );
        reference.evaluation = finalized.state;
      }
      const entity: Entity =
        target.kind === "edit"
          ? { ...existing!, reference }
          : {
              id: target.id,
              name: target.name,
              kind:
                reference.geometry.kind === "point"
                  ? "referencePoint"
                  : "referenceLine",
              constructionOrderKey: resolveConstructionIdentities(
                [...snapshot.entities, { id: target.id }],
                [target.id],
              ).orderedSources[0].constructionOrderKey,
              positions: [],
              reference,
              color: target.color,
              opacity: target.opacity,
              visible: true,
              locked: false,
              selectable: true,
            };
      validateReferenceEntity(entity);
      const next = snapshot.entities.map((source) =>
        source.id === target.id ? entity : source,
      );
      if (target.kind === "create") next.push(entity);
      const refreshed = refreshReferenceMidpoints(next, entity.id, () =>
        context.check(),
      );
      if (lockedObjectEdit(snapshot.entities, refreshed.entities))
        throw new Error("Reference Apply would edit locked geometry.");
      mutate(() =>
        host.commit(
          refreshed.entities,
          `${target.kind === "create" ? "Create" : "Edit"} reference ${reference.geometry.kind}`,
        ),
      );
      publication = {
        entityId: entity.id,
        assignedSources: [],
        refreshedEntityIds: refreshed.refreshedEntityIds,
      };
    },
  );
  return {
    ...publication!,
    cleanupPending: result.cleanupPending,
    ...(result.cleanupError ? { cleanupError: result.cleanupError } : {}),
  };
}
