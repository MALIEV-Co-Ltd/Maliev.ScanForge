import type {
  CommandContext,
  Handler,
  WorkspaceHost,
  WorkspaceSnapshot,
} from "./api";
import type { Entity } from "../types";
import type { refineGlobalScanSet } from "../scan-global-registration";

const LEASE_MS = 60_000;
type Registration = Awaited<ReturnType<typeof refineGlobalScanSet>>;
export interface GlobalAlignmentPreviewState {
  state: "idle" | "preparing" | "preview";
  previewId?: string;
  entityIds: string[];
  expiresAt?: string;
  settings?: { searchTolerance: number; parallel: boolean };
  inputSummary?: unknown;
  diagnostics?: Registration["diagnostics"];
  outer?: {
    passes: number;
    order: string[];
    gaugeId?: string;
    seed: number;
    states: {
      id: string;
      pointCount: number;
      mean: number | null;
      std: number | null;
      /** Native outer std storage holds covered records as a percentage. */
      coveragePercent: number | null;
      converged: boolean;
      stable: boolean;
    }[];
  };
  converged?: boolean;
}
interface Preview {
  id: string;
  jobId?: string;
  controller: AbortController;
  valid: () => boolean;
  entityIds: string[];
  settings: { searchTolerance: number; parallel: boolean };
  output?: Entity[];
  result?: Registration;
  inputSummary?: unknown;
  expiresAt?: number;
  timer?: ReturnType<typeof setTimeout>;
  ownsDisplay: boolean;
}
const previews = new WeakMap<WorkspaceHost, Preview>();

/** Drop all staged geometry and abort preparation without modifying model history. */
export function releaseGlobalAlignmentPreview(
  host: WorkspaceHost,
  scope?: { jobId: string },
): boolean {
  const preview = previews.get(host);
  if (!preview || (scope && preview.jobId !== scope.jobId)) return false;
  previews.delete(host);
  clearTimeout(preview.timer);
  preview.controller.abort();
  preview.output = undefined;
  preview.result = undefined;
  preview.inputSummary = undefined;
  if (preview.ownsDisplay) host.showDatumPreview?.(null);
  return true;
}
export function validateGlobalAlignmentPreview(host: WorkspaceHost): boolean {
  const preview = previews.get(host);
  if (!preview) return false;
  if (
    !preview.valid() ||
    (preview.expiresAt !== undefined && Date.now() >= preview.expiresAt)
  ) {
    releaseGlobalAlignmentPreview(host);
    return false;
  }
  return true;
}
export function inspectGlobalAlignmentPreview(
  host: WorkspaceHost,
): GlobalAlignmentPreviewState {
  if (!validateGlobalAlignmentPreview(host))
    return { state: "idle", entityIds: [] };
  const preview = previews.get(host)!;
  const result = preview.result;
  const finite = (value: number) => (Number.isFinite(value) ? value : null);
  return {
    state: preview.output ? "preview" : "preparing",
    previewId: preview.id,
    entityIds: [...preview.entityIds],
    settings: { ...preview.settings },
    ...(preview.expiresAt !== undefined
      ? { expiresAt: new Date(preview.expiresAt).toISOString() }
      : {}),
    ...(result
      ? {
          inputSummary: preview.inputSummary,
          diagnostics: result.diagnostics,
          outer: {
            passes: result.outer.passes,
            order: result.outer.order,
            gaugeId: result.outer.gaugeId,
            seed: result.outer.seed,
            states: result.outer.states.map((s) => ({
              id: s.id,
              pointCount: s.pointCount,
              mean: finite(s.mean),
              std: finite(s.std),
              coveragePercent: finite(s.std),
              converged: s.converged,
              stable: s.stable,
            })),
          },
          converged:
            result.outer.states.length === preview.entityIds.length &&
            result.outer.states.every((s) => s.converged),
        }
      : {}),
  };
}
/** Selection is view state; authored geometry, history, settings and project identity invalidate a preview. */
function sourceGuard(
  host: WorkspaceHost,
  initial: WorkspaceSnapshot,
): () => boolean {
  const entities = initial.entities.slice();
  const geometry = (e: Entity) => [
    e.positions,
    e.normals,
    e.indexedMesh,
    e.indexedMesh?.vertices,
    e.indexedMesh?.triangles,
    e.indexedMesh?.normals,
    e.pointCloudPlacement,
    e.pointCloudPlacement?.sourcePositions,
    e.pointCloudPlacement?.sourceNormals,
    e.parametric,
    e.surfacePatch,
    e.meshSelection,
    e.meshSelection?.hidden,
    e.scanSource,
    e.fit,
  ];
  const sources = entities.map(geometry);
  const history = initial.history.slice(),
    future = initial.future.slice();
  const metadata = () =>
    JSON.stringify({
      name: initial.name,
      projectId: initial.projectId,
      settings: initial.settings,
      authoring: initial.authoring,
      entities: entities.map((e) => [
        e.id,
        e.kind,
        e.name,
        e.visible,
        e.locked,
        e.selectable,
        e.kernelId,
        e.opacity,
        e.color,
        e.meshSelection?.hidden.length,
        e.fit,
        e.scanSource,
      ]),
      history: history.map((r) => r.label),
      future: future.map((r) => r.label),
    });
  const key = metadata();
  return () => {
    const next = host.snapshot();
    return (
      next.entities.length === entities.length &&
      next.entities.every(
        (e, i) =>
          e === entities[i] &&
          geometry(e).every((value, j) => value === sources[i][j]),
      ) &&
      next.history.length === history.length &&
      next.history.every((r, i) => r === history[i]) &&
      next.future.length === future.length &&
      next.future.every((r, i) => r === future[i]) &&
      JSON.stringify({
        name: next.name,
        projectId: next.projectId,
        settings: next.settings,
        authoring: next.authoring,
        entities: next.entities.map((e) => [
          e.id,
          e.kind,
          e.name,
          e.visible,
          e.locked,
          e.selectable,
          e.kernelId,
          e.opacity,
          e.color,
          e.meshSelection?.hidden.length,
          e.fit,
          e.scanSource,
        ]),
        history: next.history.map((r) => r.label),
        future: next.future.map((r) => r.label),
      }) === key
    );
  };
}
function competingPreview(host: WorkspaceHost): boolean {
  const application = host.inspectApplication?.(0) as
    { previews?: Record<string, unknown> } | undefined;
  return (
    !!host.inspectInteractive?.() ||
    [
      "interactive",
      "landmarkSession",
      "sketchSection",
      "datum",
      "scan",
      "landmarks",
      "surface",
      "globalAlignment",
    ].some((key) => !!application?.previews?.[key])
  );
}
function write(context: CommandContext, callback: () => void) {
  if (context.mutate) context.mutate(callback);
  else {
    context.check();
    callback();
  }
}

/** Shared GUI/MCP preview workflow. Lifecycle imports remain independent of geometry workers. */
export function createGlobalAlignmentOperations(
  host: WorkspaceHost,
): Record<string, Handler> {
  return {
    global_alignment_state: (_args, context) => {
      context.check();
      return inspectGlobalAlignmentPreview(host);
    },
    global_alignment_cancel: async (args, context) => {
      context.check();
      let cancelled = args.jobId === undefined;
      write(context, () => {
        const released = releaseGlobalAlignmentPreview(
          host,
          args.jobId === undefined ? undefined : { jobId: args.jobId },
        );
        cancelled ||= released;
        if (cancelled) host.setInterface?.({ globalAlignmentOpen: false });
      });
      return { cancelled };
    },
    global_alignment_preview: async (args, context) => {
      context.check();
      if (previews.has(host) || competingPreview(host))
        throw Error(
          "Cancel the current preview or alignment before preparing Global Fine Align.",
        );
      if (!host.showDatumPreview)
        throw Error("Global Fine Align preview display is unavailable.");
      const { prepareGlobalAlignmentInput, normalizeGlobalSearchTolerance } =
        await import("../global-alignment-input");
      context.check();
      if (previews.has(host) || competingPreview(host))
        throw Error(
          "Cancel the current preview before preparing Global Fine Align.",
        );
      const initial = host.snapshot();
      const ids: string[] | undefined = args.entityIds;
      if (
        ids !== undefined &&
        (!Array.isArray(ids) ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => typeof id !== "string"))
      )
        throw Error("Choose unique scan object IDs.");
      const targets = ids
        ? ids.map((id) => initial.entities.find((e) => e.id === id))
        : initial.entities.filter(
            (e) =>
              e.visible &&
              e.kind === "mesh" &&
              !e.kernelId &&
              !e.brep &&
              !e.parametric,
          );
      if (targets.length < 2 || targets.length > 32)
        throw Error("Global Fine Align requires 2 to 32 raw mesh objects.");
      if (
        targets.some(
          (e) =>
            !e ||
            e.locked ||
            !e.visible ||
            e.kind !== "mesh" ||
            e.kernelId ||
            e.brep ||
            e.parametric ||
            !e.positions.length,
        )
      )
        throw Error("Global Fine Align requires visible unlocked raw meshes.");
      // 0.5 mm is the observed persisted command UI setting, not a factory default.
      const searchTolerance = normalizeGlobalSearchTolerance(
        args.searchTolerance,
      );
      if (args.parallel !== undefined && typeof args.parallel !== "boolean")
        throw Error("Parallel must be a boolean.");
      const preview: Preview = {
        id: crypto.randomUUID(),
        jobId: context.jobId,
        controller: new AbortController(),
        valid: sourceGuard(host, initial),
        entityIds: targets.map((e) => e!.id),
        settings: { searchTolerance, parallel: args.parallel ?? true },
        ownsDisplay: false,
      };
      const abort = () => preview.controller.abort(context.signal.reason);
      context.signal.addEventListener("abort", abort, { once: true });
      previews.set(host, preview);
      const check = () => {
        context.signal.throwIfAborted();
        preview.controller.signal.throwIfAborted();
        context.check();
        if (previews.get(host) !== preview || !preview.valid())
          throw Error(
            "Workspace or Global Fine Align inputs changed; create a new preview.",
          );
      };
      try {
        check();
        const prepared = await prepareGlobalAlignmentInput(initial.entities, {
          entityIds: preview.entityIds,
          ...preview.settings,
          signal: preview.controller.signal,
          check,
          onProgress: context.progress,
        });
        let result: Registration;
        try {
          check();
          preview.entityIds = prepared.entities.map((entity) => entity.id);
          const { refineGlobalScanSet } =
            await import("../scan-global-registration");
          check();
          result = await refineGlobalScanSet(
            prepared.input,
            prepared.entities,
            {
              parallel: preview.settings.parallel,
              signal: preview.controller.signal,
              check,
              onProgress: context.progress,
              localTolerance: 0.001,
              coverageTolerance: 0.05,
            },
          );
          check();
        } finally {
          prepared.release?.();
        }
        check();
        if (
          result.entities.length !== preview.entityIds.length ||
          new Set(result.entities.map((e) => e.id)).size !==
            preview.entityIds.length ||
          preview.entityIds.some(
            (id) => !result.entities.some((e) => e.id === id),
          )
        )
          throw Error(
            "Global Fine Align returned an incomplete staged scan set.",
          );
        const staged = new Map(result.entities.map((e) => [e.id, e]));
        preview.output = initial.entities.map((e) => staged.get(e.id) ?? e);
        preview.result = result;
        preview.inputSummary = prepared.summary;
        preview.expiresAt = Date.now() + LEASE_MS;
        preview.timer = setTimeout(() => {
          if (previews.get(host) === preview)
            releaseGlobalAlignmentPreview(host);
        }, LEASE_MS);
        if (typeof preview.timer === "object" && "unref" in preview.timer)
          preview.timer.unref();
        write(context, () => {
          check();
          preview.ownsDisplay = true;
          host.showDatumPreview!(preview.output!);
        });
        return inspectGlobalAlignmentPreview(host);
      } catch (error) {
        if (previews.get(host) === preview) releaseGlobalAlignmentPreview(host);
        throw error;
      } finally {
        context.signal.removeEventListener("abort", abort);
      }
    },
    global_alignment_apply: async (args, context) => {
      context.check();
      if (!validateGlobalAlignmentPreview(host))
        throw Error(
          "Global Fine Align preview expired or changed; create a new preview.",
        );
      const preview = previews.get(host)!;
      if (args.previewId !== preview.id || !preview.output)
        throw Error("Unknown or incomplete Global Fine Align preview.");
      const state = inspectGlobalAlignmentPreview(host);
      // Native clocks influence the computed result. Adopt this exact staged set once.
      write(context, () => {
        if (!validateGlobalAlignmentPreview(host))
          throw Error(
            "Global Fine Align preview changed; create a new preview.",
          );
        host.commit(preview.output!, "Global Fine Align");
        releaseGlobalAlignmentPreview(host);
        host.setInterface?.({ globalAlignmentOpen: false });
      });
      return {
        applied: true,
        entityIds: state.entityIds,
        diagnostics: state.diagnostics,
        inputSummary: state.inputSummary,
        settings: state.settings,
        outer: state.outer,
        converged: state.converged,
      };
    },
  };
}
