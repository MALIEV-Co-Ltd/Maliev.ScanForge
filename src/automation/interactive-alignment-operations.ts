import type { WorkspaceHost, Handler, CommandContext } from "./api";
import { InteractiveAlignmentSession } from "../interactive-alignment-session";
import { InteractiveBoundsPool } from "../interactive-bounds-pool";
import { cloudPlacement, composeCloudPose } from "../point-cloud-placement";
import {
  nativeInteractiveStep,
  nativeInteractiveDrag,
  nativeInteractiveCurrentView,
} from "../interactive-alignment-math";
import { nativeDatumInverseFrame } from "../scan-native-datum-apply";
interface SessionBox {
  session?: InteractiveAlignmentSession;
  pool?: InteractiveBoundsPool;
  execution?: unknown;
}
const boxes = new WeakMap<WorkspaceHost, SessionBox>();
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
export function releaseInteractiveSession(host: WorkspaceHost) {
  const box = boxes.get(host);
  if (!box) return;
  box.pool?.close();
  box.pool = undefined;
  box.session = undefined;
  box.execution = undefined;
  host.publishInteractive?.(null);
}
export function createInteractiveOperations(
  host: WorkspaceHost,
): Record<string, Handler> {
  const box: SessionBox = {};
  boxes.set(host, box);
  const publish = () => {
    const state = box.session?.inspect() ?? null;
    host.publishInteractive?.(state);
    return state
      ? { active: true, ...state, boundsExecution: box.execution }
      : { active: false };
  };
  const change = (
    s: InteractiveAlignmentSession,
    write: () => void,
    finish?: () => void,
  ) => {
    const rollback = s.checkpoint();
    try {
      write();
      const result = publish();
      finish?.();
      return result;
    } catch (error) {
      try {
        rollback();
        publish();
      } catch (restore) {
        throw new AggregateError(
          [error, restore],
          "Interactive publication failed and restoring its display also failed.",
        );
      }
      throw error;
    }
  };
  const requireSession = (args: Record<string, any>) => {
    const s = box.session;
    if (!s) throw new Error("Begin Interactive alignment first.");
    const state = s.inspect();
    if (
      args.sessionId !== state.sessionId ||
      args.expectedSessionVersion !== state.version
    )
      throw new Error(
        "Interactive session changed; inspect its current state and use a new request ID.",
      );
    s.validate(host.snapshot().entities);
    return s;
  };
  async function bounds(
    poses: { entityId: string; matrix: number[] }[],
    context: CommandContext,
  ) {
    const results = [];
    for (let i = 0; i < poses.length; i++) {
      context.check();
      const p = poses[i];
      const result = await box.pool!.measure(
        p.entityId,
        p.matrix,
        context.signal,
      );
      context.check();
      if (!result.valid)
        throw new Error("Interactive target has no valid scan points.");
      box.execution = result.execution;
      results.push({
        min: Array.from(result.values.slice(0, 3)),
        max: Array.from(result.values.slice(3, 6)),
      });
    }
    return results;
  }
  const center = (values: { min: number[]; max: number[] }[]) => {
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (const b of values)
      for (let a = 0; a < 3; a++) {
        if (b.min[a] <= min[a]) min[a] = b.min[a];
        if (max[a] <= b.max[a]) max[a] = b.max[a];
      }
    return min.map((v, i) => Math.fround(Math.fround(v + max[i]) * 0.5));
  };
  return {
    interactive_alignment_get: () => {
      const s = box.session;
      if (!s) return { active: false };
      return {
        active: true,
        ...s.inspect(),
        stale: host.snapshot().entities !== s.baseEntities,
        boundsExecution: box.execution,
      };
    },
    interactive_alignment_edit: async (args, context) => {
      context.check();
      if (args.action === "begin") {
        if (box.session || box.pool)
          throw new Error("Finish or cancel the current Interactive session.");
        if (!host.publishInteractive)
          throw new Error("Interactive alignment requires the browser editor.");
        const previews = (
          host.inspectApplication?.(0) as
            { previews?: Record<string, boolean> } | undefined
        )?.previews;
        if (previews && Object.values(previews).some(Boolean))
          throw new Error("Finish or cancel the current preview first.");
        const snapshot = host.snapshot();
        const ids = (args.entityIds ??
          (snapshot.selectedIds?.length
            ? snapshot.selectedIds
            : snapshot.selectedId
              ? [snapshot.selectedId]
              : [])) as string[];
        // Validate every target before allocating background resources.
        const s = new InteractiveAlignmentSession(
          snapshot.entities,
          ids,
          [0, 0, 0],
        );
        const sources = new Map(
          ids.map((id) => {
            const e = snapshot.entities.find((e) => e.id === id)!;
            const positions =
              cloudPlacement(e)?.sourcePositions ??
              e.indexedMesh?.vertices ??
              e.positions;
            return [
              id,
              {
                positions:
                  positions instanceof Float32Array
                    ? positions
                    : Float32Array.from(positions),
              },
            ];
          }),
        );
        const pool = new InteractiveBoundsPool(sources, {
          parallel: args.parallel,
        });
        box.pool = pool;
        try {
          const values = await bounds(s.inspect().targets, context);
          s.validate(host.snapshot().entities);
          context.check();
          box.session = new InteractiveAlignmentSession(
            snapshot.entities,
            ids,
            center(values),
          );
          return publish();
        } catch (error) {
          pool.close();
          if (box.pool === pool) {
            box.pool = undefined;
            box.session = undefined;
            try {
              host.publishInteractive?.(null);
            } catch (cleanup) {
              throw new AggregateError(
                [error, cleanup],
                `Interactive preview failed: ${error instanceof Error ? error.message : String(error)}; restoring its display also failed.`,
              );
            }
          }
          throw error;
        }
      }
      const s = requireSession(args);
      let delta: number[] | undefined;
      if (args.action === "configure") {
        const patch: Partial<{
          strength: number;
          mirror: boolean;
          mirrorPlane: 0 | 1 | 2;
        }> = {};
        if (args.strength !== undefined) patch.strength = args.strength;
        if (args.mirror !== undefined) patch.mirror = args.mirror;
        if (args.mirrorPlane !== undefined) {
          if (!["XY", "YZ", "XZ"].includes(args.mirrorPlane))
            throw new Error("Mirror preview plane must be XY, YZ or XZ.");
          patch.mirrorPlane = ({ XY: 0, YZ: 1, XZ: 2 } as const)[
            args.mirrorPlane as "XY" | "YZ" | "XZ"
          ];
        }
        if (!Object.keys(patch).length)
          throw new Error("Choose a drag-strength or mirror-preview setting.");
        return change(s, () => s.configure(patch));
      }
      if (args.action === "reset") {
        return change(s, () => s.reset());
      }
      if (args.action === "step") {
        if (
          args.kind === undefined ||
          args.axis === undefined ||
          args.value === undefined
        )
          throw new Error("Choose a step kind, axis and value.");
        delta = nativeInteractiveStep(args.kind, args.axis, args.value);
      } else if (args.action === "currentView") {
        if (!host.interactiveViewFrame || !host.finishInteractiveCurrentView)
          throw new Error("Interactive view capture/reset is unavailable.");
        const view = host.interactiveViewFrame();
        delta = nativeInteractiveCurrentView(view.matrix, view.anchor);
      } else if (args.action === "drag") {
        if (
          !host.interactiveDragInput ||
          args.handle === undefined ||
          !args.from ||
          !args.to
        )
          throw new Error(
            "Choose an available gizmo handle and two viewport points.",
          );
        const state = s.inspect();
        const input = host.interactiveDragInput({
          handle: args.handle,
          from: args.from,
          to: args.to,
          pivot: state.pivot,
          strength: state.strength,
          continuation: args.continuation,
        });
        if (!input)
          return {
            active: true,
            ...state,
            boundsExecution: box.execution,
            accepted: false,
            waiting: true,
          };
        const result = nativeInteractiveDrag(input);
        if (!result.accepted)
          return {
            active: true,
            ...state,
            boundsExecution: box.execution,
            accepted: false,
          };
        if (args.handle <= 6) {
          delta = identity();
          for (let a = 0; a < 3; a++)
            delta[a * 4 + 3] =
              result.matrix[a * 4 + 3] - input.original[a * 4 + 3];
        } else
          delta = composeCloudPose(
            composeCloudPose(input.original, result.matrix),
            nativeDatumInverseFrame(input.original),
          );
        return { ...change(s, () => s.advance(delta!)), accepted: true };
      } else throw new Error("Unsupported Interactive action.");
      const next = s.inspect().targets.map((p) => ({
        entityId: p.entityId,
        matrix: composeCloudPose(delta!, p.matrix),
      }));
      const values = await bounds(next, context);
      s.validate(host.snapshot().entities);
      context.check();
      return change(
        s,
        () => s.advance(delta!, values),
        args.action === "currentView"
          ? () => host.finishInteractiveCurrentView!()
          : undefined,
      );
    },
    interactive_alignment_apply: async (args, context) => {
      const s = requireSession(args);
      const result = await s.bake({
        signal: context.signal,
        parallel: args.parallel,
        check: () => {
          context.check();
          s.validate(host.snapshot().entities);
        },
      });
      context.check();
      s.validate(host.snapshot().entities);
      const changed = result !== s.baseEntities;
      const write = () => {
        releaseInteractiveSession(host);
        if (changed) host.commit(result, "Interactive alignment");
      };
      if (context.mutate) context.mutate(write);
      else write();
      return {
        applied: changed,
        entityIds: [...s.targetIds],
        geometryBakedOnce: changed,
      };
    },
  };
}
