import type { Handler, WorkspaceHost } from "./api";
import { evaluateCadAlignmentReference } from "../cad/alignment-reference";
import {
  referenceDatumFeature,
  storedFrameDatumReferences,
} from "../alignment-reference-entity";
import {
  nativeDatumFitFeature,
  nativeDatumPickedFeature,
} from "../scan-native-datum-feature";

export interface AlignmentReference {
  id: string;
  source: "cadFace" | "fittedPrimitive" | "referenceConstruction";
  kind: "plane" | "direction" | "point" | "unsupported";
  label?: string;
  point?: number[];
  direction?: number[];
  length?: number;
  radiusMm?: number;
  faceIndex?: number;
  firstTriangle?: number;
  triangleCount?: number;
  surfaceKind?: string;
  surfaceType?: number;
}
export interface AlignmentReferencePage {
  entityId: string;
  units: "mm";
  total: number;
  offset: number;
  nextOffset: number | null;
  references: AlignmentReference[];
}

/** Shared, read-only reference discovery for both the inspector and MCP. */
export function createAlignmentOperations(
  host: WorkspaceHost,
): Record<string, Handler> {
  return {
    alignment_references: async (
      args,
      context,
    ): Promise<AlignmentReferencePage> => {
      const entity = host
        .snapshot()
        .entities.find((item) => item.id === args.entityId);
      if (!entity)
        throw new Error("Alignment reference object is not in this project.");
      context.check();
      let references: AlignmentReference[] = storedFrameDatumReferences(
        entity,
        args.centerAt,
      ).map(({ key, ...reference }) => ({
        ...reference,
        id: `${entity.id}/${key}`,
        source: "referenceConstruction",
      }));
      const semantic = referenceDatumFeature(entity);
      if (semantic) {
        const kind = semantic.kind === "referencePoint" ? "point" : "direction";
        const value = nativeDatumPickedFeature(semantic, kind);
        if (
          !value ||
          !value.point.every(Number.isFinite) ||
          (value.direction && !value.direction.every(Number.isFinite))
        )
          throw new Error(
            "Reference datum geometry exceeds the finite numeric range.",
          );
        references.push({
          id: `${entity.id}/reference/${kind}`,
          source: "referenceConstruction",
          kind,
          point: value.point,
          ...(value.direction ? { direction: value.direction } : {}),
          ...(semantic.length !== undefined ? { length: semantic.length } : {}),
          surfaceKind: semantic.kind,
        });
      }
      if (entity.kernelId) {
        context.progress(0.1, "Reading exact CAD faces");
        const inputs = await host.cad().alignmentReferences(entity.kernelId);
        context.check();
        references = inputs.map((input) => {
          const value = evaluateCadAlignmentReference(input, args.centerAt);
          const identity = {
            id: `${entity.id}/face/${input.faceIndex}`,
            source: "cadFace" as const,
            faceIndex: value.faceIndex,
            firstTriangle: value.firstTriangle,
            triangleCount: value.triangleCount,
            surfaceKind: value.kind,
          };
          if (value.kind === "unsupported")
            return {
              ...identity,
              kind: "unsupported",
              surfaceType: value.surfaceType,
            };
          if ("normal" in value)
            return {
              ...identity,
              kind: "plane",
              point: value.point,
              direction: value.normal,
            };
          return {
            ...identity,
            kind: "direction",
            point: value.point,
            direction: value.direction,
            length: value.length,
            ...(value.kind === "cylinder" ? { radiusMm: value.radiusMm } : {}),
          };
        });
      }
      if (entity.fit) {
        const feature = nativeDatumFitFeature(entity.fit);
        for (const kind of ["plane", "direction", "point"] as const) {
          const value = nativeDatumPickedFeature(feature, kind, args.centerAt);
          if (value)
            references.push({
              id: `${entity.id}/fit/${kind}`,
              source: "fittedPrimitive",
              kind,
              point: value.point,
              direction: value.direction,
              surfaceKind: entity.fit.kind,
            });
        }
      }
      context.check();
      const offset = args.offset ?? 0,
        limit = args.limit ?? 50;
      if (args.triangleIndex !== undefined) {
        const triangle = args.triangleIndex;
        references = references.filter(
          (reference) =>
            reference.source === "cadFace" &&
            reference.firstTriangle !== undefined &&
            reference.triangleCount !== undefined &&
            triangle >= reference.firstTriangle &&
            triangle < reference.firstTriangle + reference.triangleCount,
        );
        if (references.length !== 1)
          throw new Error(
            "The picked triangle does not identify one exact CAD face.",
          );
      }
      if (offset > references.length)
        throw new Error(
          "Reference offset exceeds the available reference count.",
        );
      return {
        entityId: entity.id,
        units: "mm",
        total: references.length,
        offset,
        nextOffset: offset + limit < references.length ? offset + limit : null,
        references: references.slice(offset, offset + limit),
      };
    },
  };
}
