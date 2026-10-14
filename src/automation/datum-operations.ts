import type { Handler, WorkspaceHost } from "./api";
import {
  buildDatumAlignment,
  transformDatumScan,
  type DatumInstruction,
} from "../datum-alignment";
import type { Entity } from "../types";

export interface DatumRequest {
  entityIds: string[];
  constraints: DatumInstruction[];
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
    const frame = buildDatumAlignment(args.constraints, args.translation);
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
      const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
      const changed = result.matrix.some(
        (value, index) => value !== identity[index],
      );
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
