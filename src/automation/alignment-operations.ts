import type { Handler, WorkspaceHost } from "./api";
import { evaluateCadAlignmentReference } from "../cad/alignment-reference";
import {
  nativeDatumFitFeature,
  nativeDatumPickedFeature,
} from "../scan-native-datum-feature";

export interface AlignmentReference {
  id: string;
  source: "cadFace" | "fittedPrimitive";
  kind: "plane" | "direction" | "point" | "unsupported";
  point?: number[];
  direction?: number[];
  length?: number;
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
      let references: AlignmentReference[] = [];
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
