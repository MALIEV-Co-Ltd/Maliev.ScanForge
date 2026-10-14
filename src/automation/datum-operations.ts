import type { Handler, WorkspaceHost } from "./api";
import { buildDatumAlignment, type DatumInstruction } from "../datum-alignment";
import type { Entity } from "../types";
import { nativeDatumIsIdentity } from "../scan-native-datum-apply";
import { nativeDatumCadTransform } from "../scan-native-datum-cad-transform";
import { createDatumTransformExecutor } from "../datum-transform-pool";
import { datumFeatureMetadata } from "../scan-native-datum-primitive";
import {
  adoptDatumPreview,
  releaseDatumPreview,
} from "./datum-preview-resources";
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
  parallel?: boolean;
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
      if (!entity.positions.length)
        throw new Error("An empty scan cannot be aligned.");
      if (entity.positions.length % 3)
        throw new Error("Alignment transform requires XYZ coordinates.");
      if (
        entity.locked ||
        (!entity.kernelId &&
          (entity.parametric || !["mesh", "pointcloud"].includes(entity.kind)))
      )
        throw new Error(
          "Select unlocked mesh, point cloud or exact CAD targets.",
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
    const identity = nativeDatumIsIdentity(frame.state.matrix);
    const cadMatrix = nativeDatumCadTransform(frame.matrix);
    const kernelIds: string[] = [];
    const diagnostics = new Map<
      string,
      { bounds: { min: number[]; max: number[] }; execution: unknown }
    >();
    const executor = identity
      ? undefined
      : createDatumTransformExecutor({
          parallel: args.parallel,
          signal: context.signal,
        });
    try {
      for (let index = 0; index < targets.length; index++) {
        context.progress(
          index / targets.length,
          "Transforming scan coordinates",
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        context.check();
        const entity = targets[index];
        if (identity) {
          const min = [Infinity, Infinity, Infinity],
            max = [-Infinity, -Infinity, -Infinity];
          for (
            let offset = 0;
            offset < entity.positions.length;
            offset += 262_144 * 3
          ) {
            context.check();
            const end = Math.min(entity.positions.length, offset + 262_144 * 3);
            for (let i = offset; i < end; i += 3)
              for (let axis = 0; axis < 3; axis++) {
                const value = entity.positions[i + axis];
                if (!Number.isFinite(value) || Math.abs(value) > 1e9)
                  throw new Error(
                    "Aligned scan coordinates exceed the supported range.",
                  );
                min[axis] = Math.min(min[axis], value);
                max[axis] = Math.max(max[axis], value);
              }
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          transformed.set(entity.id, entity);
          diagnostics.set(entity.id, {
            bounds: { min, max },
            execution: {
              physicalWorkers: 0,
              chunkVertices: 262_144,
              fallbackReason: "identity transform",
            },
          });
          continue;
        }
        if (entity.kernelId) {
          const result = await host
            .cad()
            .transformDatum(entity.kernelId, frame.matrix);
          kernelIds.push(result.kernelId);
          context.check();
          if (
            result.placementMatrix.length !== 12 ||
            !result.placementMatrix.every((value, i) =>
              Object.is(value, cadMatrix[i]),
            )
          )
            throw new Error(
              "Exact CAD placement disagrees with the verified native frame.",
            );
          const min = [Infinity, Infinity, Infinity],
            max = [-Infinity, -Infinity, -Infinity];
          if (!result.positions.length || result.positions.length % 9)
            throw new Error(
              "Exact CAD alignment returned invalid display geometry.",
            );
          for (let i = 0; i < result.positions.length; i++) {
            const value = result.positions[i];
            if (!Number.isFinite(value) || Math.abs(value) > 1e9)
              throw new Error(
                "Aligned CAD coordinates exceed the supported range.",
              );
            min[i % 3] = Math.min(min[i % 3], value);
            max[i % 3] = Math.max(max[i % 3], value);
          }
          const { placementMatrix: _placementMatrix, ...geometry } = result;
          transformed.set(entity.id, {
            ...entity,
            ...geometry,
            parametric: undefined,
            fit: datumFeatureMetadata(entity, cadMatrix).fit,
            surfacePatch: undefined,
            surfaceScanId: undefined,
            indexedMesh: undefined,
            meshSelection: undefined,
          });
          diagnostics.set(entity.id, {
            bounds: { min, max },
            execution: {
              backend: "OpenCascade",
              copyGeometry: false,
              physicalWorkers: 1,
            },
          });
          continue;
        }
        const result = await executor!.transformScan(entity, frame.matrix);
        transformed.set(entity.id, result.entity);
        diagnostics.set(entity.id, {
          bounds: result.bounds,
          execution: result.execution,
        });
      }
      context.check();
    } catch (error) {
      if (kernelIds.length) await host.cad().release(kernelIds);
      throw error;
    } finally {
      executor?.close();
    }
    const next = snapshot.entities.map(
      (item) => transformed.get(item.id) ?? item,
    );
    const summary = {
      units: "mm",
      translation: args.translation ?? [0, 0, 0],
      constraints: instructions,
      matrix: frame.matrix,
      cadMatrix,
      frame: frame.state,
      targets: targets.map((item) => {
        const output = transformed.get(item.id)!;
        return {
          entityId: item.id,
          count: output.positions.length / (item.kind === "pointcloud" ? 3 : 9),
          kind: item.kind,
          fit: output.fit,
          planeFrame: output.planeFrame,
          ...diagnostics.get(item.id),
        };
      }),
    };
    return { next, summary, matrix: frame.matrix, kernelIds };
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
      let adopted = false;
      try {
        context.check();
        await adoptDatumPreview(host, result.kernelIds);
        adopted = true;
        context.check();
        host.showDatumPreview(result.next);
        await host.present?.(context.signal);
        context.check();
      } catch (error) {
        host.showDatumPreview(null);
        if (adopted) await releaseDatumPreview(host);
        else if (result.kernelIds.length)
          await host.cad().release(result.kernelIds);
        throw error;
      }
      return {
        ...result.summary,
        preview: true,
        committedGeometryPreserved: true,
      };
    },
    alignment_apply: async (args, context) => {
      const result = await prepare(args as DatumRequest, context);
      const changed = !nativeDatumIsIdentity(result.summary.frame.matrix);
      let committed = false;
      try {
        context.check();
        host.showDatumPreview?.(null);
        await releaseDatumPreview(host);
        context.check();
        if (changed && host.showDatumPreview) {
          host.showDatumPreview(result.next);
          await host.present?.(context.signal);
        }
        context.check();
        if (changed) {
          host.commit(result.next, "Align scans to origin/reference frame");
          committed = true;
        }
        host.showDatumPreview?.(null);
      } catch (error) {
        host.showDatumPreview?.(null);
        if (!committed && result.kernelIds.length)
          await host.cad().release(result.kernelIds);
        throw error;
      }
      return { ...result.summary, changed, preview: false };
    },
  };
}
