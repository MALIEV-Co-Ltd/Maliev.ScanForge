import type { Handler, WorkspaceHost } from "./api";
import {
  buildDatumAlignment,
  transformDatumScan,
  type DatumInstruction,
} from "../datum-alignment";
import type { Entity } from "../types";
import { nativeDatumIsIdentity } from "../scan-native-datum-apply";
import {
  createAlignmentOperations,
  type AlignmentReferencePage,
} from "./alignment-operations";

export interface DatumReferenceConstraint {
  kind: "reference";
  entityId: string;
  referenceId: string;
  axis: 0 | 1 | 2;
  flip?: boolean;
  centerAt?: number[];
}

export interface DatumRequest {
  entityIds: string[];
  constraints: (DatumInstruction | DatumReferenceConstraint)[];
  translation?: number[];
}
export function createDatumOperations(
  host: WorkspaceHost,
): Record<string, Handler> {
  const prepare = async (
    args: DatumRequest,
    context: Parameters<Handler>[1],
  ) => {
    const snapshot = host.snapshot();
    if (
      !args.entityIds.length ||
      new Set(args.entityIds).size !== args.entityIds.length
    )
      throw new Error("Select distinct scans to align.");
    const targets = args.entityIds.map((id) => {
      const entity = snapshot.entities.find((item) => item.id === id);
      if (!entity) throw new Error(`Scan ${id} is not in this project.`);
      if (
        entity.locked ||
        entity.kernelId ||
        entity.parametric ||
        !["mesh", "pointcloud"].includes(entity.kind)
      )
        throw new Error(
          "Select unlocked mesh or point cloud targets; exact CAD targets are not supported yet.",
        );
      return entity;
    });
    const references = new Map<string, AlignmentReferencePage>();
    const instructions: DatumInstruction[] = [];
    for (const constraint of args.constraints) {
      if (constraint.kind !== "reference") {
        instructions.push(constraint);
        continue;
      }
      const key = JSON.stringify([constraint.entityId, constraint.centerAt]);
      let page = references.get(key);
      if (!page) {
        page = (await createAlignmentOperations(host).alignment_references(
          {
            entityId: constraint.entityId,
            centerAt: constraint.centerAt,
            offset: 0,
            limit: 10002,
          },
          context,
        )) as AlignmentReferencePage;
        references.set(key, page);
      }
      context.check();
      const reference = page.references.find(
        (item) => item.id === constraint.referenceId,
      );
      if (!reference || reference.kind === "unsupported" || !reference.point)
        throw new Error(
          "Select a supported reference belonging to the chosen alignment object.",
        );
      instructions.push({
        kind: reference.kind,
        point: reference.point,
        direction: reference.direction,
        axis: constraint.axis,
        flip: constraint.flip,
      });
    }
    const frame = buildDatumAlignment(instructions, args.translation);
    if (!frame.accepted)
      throw new Error(
        `Reference ${frame.steps.findIndex((step) => !step.accepted) + 1} is incompatible with the preceding frame constraints.`,
      );
    context.check();
    const transformed = new Map<string, Entity>();
    for (let index = 0; index < targets.length; index++) {
      context.progress(index / targets.length, "Transforming scan coordinates");
      await new Promise((resolve) => setTimeout(resolve, 0));
      context.check();
      const entity = targets[index];
      transformed.set(entity.id, transformDatumScan(entity, frame.matrix));
    }
    context.check();
    const next = snapshot.entities.map(
      (item) => transformed.get(item.id) ?? item,
    );
    const summary = {
      units: "mm",
      translation: args.translation ?? [0, 0, 0],
      constraints: instructions,
      matrix: frame.matrix,
      frame: frame.state,
      targets: targets.map((item) => {
        const output = transformed.get(item.id)!;
        const min = [Infinity, Infinity, Infinity],
          max = [-Infinity, -Infinity, -Infinity];
        for (let offset = 0; offset < output.positions.length; offset += 3)
          for (let axis = 0; axis < 3; axis++) {
            min[axis] = Math.min(min[axis], output.positions[offset + axis]);
            max[axis] = Math.max(max[axis], output.positions[offset + axis]);
          }
        return {
          entityId: item.id,
          count: output.positions.length / (item.kind === "pointcloud" ? 3 : 9),
          kind: item.kind,
          bounds: { min, max },
        };
      }),
    };
    return { next, summary, matrix: frame.matrix };
  };
  return {
    alignment_preview: async (args, context) => {
      if (!host.showDatumPreview)
        throw new Error(
          "Coordinate alignment preview requires the browser editor.",
        );
      const previews = (
        host.inspectApplication?.(0) as
          { previews?: Record<string, boolean> } | undefined
      )?.previews;
      if (
        previews &&
        Object.entries(previews).some(
          ([kind, value]) => kind !== "datum" && value,
        )
      )
        throw new Error(
          "Finish or cancel the active preview before previewing coordinate alignment.",
        );
      const result = await prepare(args as DatumRequest, context);
      context.check();
      host.showDatumPreview(result.next);
      await host.present?.(context.signal);
      context.check();
      return {
        ...result.summary,
        preview: true,
        committedGeometryPreserved: true,
      };
    },
    alignment_apply: async (args, context) => {
      const result = await prepare(args as DatumRequest, context);
      const changed = !nativeDatumIsIdentity(result.summary.frame.matrix);
      context.check();
      try {
        if (changed && host.showDatumPreview) {
          host.showDatumPreview(result.next);
          await host.present?.(context.signal);
        }
        context.check();
        if (changed)
          host.commit(result.next, "Align scans to origin/reference frame");
        host.showDatumPreview?.(null);
      } catch (error) {
        host.showDatumPreview?.(null);
        throw error;
      }
      return { ...result.summary, changed, preview: false };
    },
  };
}
