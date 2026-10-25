import type { CommandContext, WorkspaceHost } from "./api";
import type { Entity } from "../types";
import { applyReferenceConstructionPreview } from "./reference-construction-preview";
import { resolveConstructionIdentities } from "../reference-construction-identity";
import {
  copyReferenceEntityData,
  validateReferenceEntity,
} from "../reference-entity";
import { datumEntityDependencies } from "../datum-dependencies";
import { lockedObjectEdit } from "../object-operations";

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
      }
    | undefined;
  const result = applyReferenceConstructionPreview(
    host,
    request.owner,
    request.version,
    (candidate) => {
      context.check();
      if (
        candidate.definition.mode !== "coordinates" &&
        candidate.definition.mode !== "endpoints"
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
        if (
          datumEntityDependencies(snapshot.entities).some(
            (row) => row.id !== target.id && row.references.includes(target.id),
          )
        )
          throw new Error(
            "Reference dependency rebuild is required before editing this source.",
          );
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
        definition: candidate.definition,
        geometry: candidate.preview.geometry,
        evaluation: candidate.preview.state,
      });
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
      const assigned = new Map(
        identities.assignments.map((source) => [
          source.id,
          source.constructionOrderKey,
        ]),
      );
      const next = snapshot.entities.map((source) =>
        source.id === target.id
          ? entity
          : assigned.has(source.id)
            ? { ...source, constructionOrderKey: assigned.get(source.id)! }
            : source,
      );
      if (target.kind === "create") next.push(entity);
      const policy = { constructionIdentityMigration: identities.assignments };
      if (lockedObjectEdit(snapshot.entities, next, policy))
        throw new Error("Reference Apply would edit locked geometry.");
      mutate(() =>
        host.commit(
          next,
          `${target.kind === "create" ? "Create" : "Edit"} reference ${reference.geometry.kind}`,
          policy,
        ),
      );
      publication = {
        entityId: entity.id,
        assignedSources: identities.assignments.map((source) => ({
          ...source,
        })),
      };
    },
  );
  return {
    ...publication!,
    cleanupPending: result.cleanupPending,
    ...(result.cleanupError ? { cleanupError: result.cleanupError } : {}),
  };
}
