import { nativeGlobalInvertRigid } from "../scan-native-global-outer";
import {
  initializeGlobalAlignment,
  refineGlobalSurfaceAlignment,
  type GlobalInitializationResult,
} from "../global-alignment-initialization";
import { composeCloudPose } from "../point-cloud-placement";
import type {
  CommandContext,
  Handler,
  WorkspaceHost,
  WorkspaceSnapshot,
} from "./api";
import type { Entity } from "../types";
import { cloudPoseBits } from "../point-cloud-placement";
import type { refineGlobalScanSet } from "../scan-global-registration";
import { assertNoUnresolvedOwnedWorkers } from "../scan-global-worker-cleanup";

const LEASE_MS = 60_000;
type Registration = Awaited<ReturnType<typeof refineGlobalScanSet>>;
export interface GlobalAlignmentProgress {
  sequence: number;
  phase: "initializing" | "preparing" | "refining";
  stage?: string;
  pass: number;
  poses: { id: string; matrix: number[]; matrixBits: string }[];
}
export interface GlobalAlignmentPreviewState {
  progress?: GlobalAlignmentProgress;
  initialization?: GlobalInitializationResult;
  surfaceRefinement?: GlobalInitializationResult;
  state: "idle" | "preparing" | "preview";
  previewId?: string;
  entityIds: string[];
  expiresAt?: string;
  settings?: {
    searchTolerance: number;
    parallel: boolean;
    initialization?: "automatic" | "current";
  };
  coordinateStages?: {
    id: string;
    matrices: number[][];
    matrixBits: string[];
  }[];
  inputSummary?: unknown;
  diagnostics?: Registration["diagnostics"];
  outer?: {
    matrixFormat: "row-major-3x4";
    matrixEncoding: "float64-le-hex";
    translationUnits: "mm";
    applications: { id: string; matrix: number[]; matrixBits: string }[];
    passes: number;
    order: string[];
    gaugeId?: string;
    seed: number;
    states: {
      id: string;
      matrix: number[];
      matrixBits: string;
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
  settings: {
    searchTolerance: number;
    parallel: boolean;
    initialization: "automatic" | "current";
  };
  initialization?: GlobalInitializationResult;
  surfaceRefinement?: GlobalInitializationResult;
  progress?: GlobalAlignmentProgress;
  ownsPoseDisplay?: boolean;
  output?: Entity[];
  result?: Registration;
  inputSummary?: unknown;
  expiresAt?: number;
  timer?: ReturnType<typeof setTimeout>;
  ownsDisplay: boolean;
}
const previews = new WeakMap<WorkspaceHost, Preview>();

/** Internal environmental replay only; never part of the public tool arguments. */
export interface GlobalAlignmentEnvironment {
  sceneClocks?: ReadonlyMap<string, readonly number[]>;
  clock?: () => number;
}

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
  if (preview.ownsPoseDisplay) host.showGlobalAlignmentProgress?.(null);
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
    ...(preview.progress && !preview.output
      ? {
          progress: {
            ...preview.progress,
            poses: preview.progress.poses.map((p) => ({
              ...p,
              matrix: [...p.matrix],
            })),
          },
        }
      : {}),
    ...(preview.initialization
      ? {
          initialization: {
            anchorId: preview.initialization.anchorId,
            fits: preview.initialization.fits.map((p) => ({
              ...p,
              matrix: [...p.matrix],
            })),
          },
        }
      : {}),
    ...(preview.expiresAt !== undefined
      ? { expiresAt: new Date(preview.expiresAt).toISOString() }
      : {}),
    ...(preview.surfaceRefinement
      ? {
          surfaceRefinement: {
            anchorId: preview.surfaceRefinement.anchorId,
            order: preview.surfaceRefinement.order
              ? [...preview.surfaceRefinement.order]
              : undefined,
            fits: preview.surfaceRefinement.fits.map((f) => ({
              ...f,
              matrix: [...f.matrix],
            })),
          },
        }
      : {}),
    ...(result
      ? {
          coordinateStages: preview.entityIds.map((id) => {
            const matrices: number[][] = [];
            if (
              preview.initialization &&
              id !== preview.initialization.anchorId
            )
              matrices.push([
                ...preview.initialization.fits.find((f) => f.id === id)!.matrix,
              ]);
            matrices.push(
              ...result.outer.applications
                .filter((a) => a.id === id)
                .map((a) => [...a.matrix]),
            );
            if (
              preview.surfaceRefinement &&
              id !== preview.surfaceRefinement.anchorId
            )
              matrices.push([
                ...preview.surfaceRefinement.fits.find((f) => f.id === id)!
                  .matrix,
              ]);
            return { id, matrices, matrixBits: matrices.map(cloudPoseBits) };
          }),
          inputSummary: preview.inputSummary,
          diagnostics: result.diagnostics,
          outer: {
            matrixFormat: "row-major-3x4",
            matrixEncoding: "float64-le-hex",
            translationUnits: "mm",
            applications: result.outer.applications.map((s) => ({
              id: s.id,
              matrix: [...s.matrix],
              matrixBits: cloudPoseBits(s.matrix),
            })),
            passes: result.outer.passes,
            order: [...result.outer.order],
            gaugeId: result.outer.gaugeId,
            seed: result.outer.seed,
            states: result.outer.states.map((s) => ({
              id: s.id,
              matrix: [...s.matrix],
              matrixBits: cloudPoseBits(s.matrix),
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
/** Derived viewport measurements do not change the authored alignment inputs. */
function authoredSettings(settings: WorkspaceSnapshot["settings"]) {
  const { effectiveGridSpacing: _grid, scale: _scale, ...authored } = settings;
  return authored;
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
    e.indexedMesh?.geometryNormals,
    e.indexedMesh?.facetNormals,
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
      settings: authoredSettings(initial.settings),
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
    const valid =
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
        settings: authoredSettings(next.settings),
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
      }) === key;
    return valid;
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
  environment?: GlobalAlignmentEnvironment,
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
      const initialization = args.initialization ?? "automatic";
      if (initialization !== "automatic" && initialization !== "current")
        throw Error("Choose automatic placement or current scan poses.");
      const preview: Preview = {
        id: crypto.randomUUID(),
        jobId: context.jobId,
        controller: new AbortController(),
        valid: sourceGuard(host, initial),
        entityIds: targets.map((e) => e!.id),
        settings: {
          searchTolerance,
          parallel: args.parallel ?? true,
          initialization,
        },
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
      const baseMatrices = new Map<string, readonly number[]>(
        targets.map((e) => [e!.id, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]]),
      );
      const publish = (
        phase: GlobalAlignmentProgress["phase"],
        pass: number,
        poses: { id: string; matrix: readonly number[] }[],
      ) => {
        check();
        preview.progress = {
          sequence: (preview.progress?.sequence ?? 0) + 1,
          phase,
          pass,
          poses: poses.map((p) => ({
            id: p.id,
            matrix: [...p.matrix],
            matrixBits: cloudPoseBits(p.matrix),
          })),
        };
        if (host.showGlobalAlignmentProgress)
          write(context, () => {
            check();
            preview.ownsPoseDisplay = true;
            host.showGlobalAlignmentProgress!(
              poses.map((p) => ({ entityId: p.id, matrix: p.matrix })),
            );
          });
      };
      try {
        check();
        assertNoUnresolvedOwnedWorkers();
        let inputEntities = targets as Entity[];
        if (initialization === "automatic") {
          context.progress(0, "Finding automatic coarse placement");
          const initialized = await initializeGlobalAlignment(inputEntities, {
            signal: preview.controller.signal,
            check,
            parallel: preview.settings.parallel,
            onProgress: (n, stage) => {
              context.progress(n * 0.15, stage);
              if (preview.progress)
                preview.progress = {
                  ...preview.progress,
                  sequence: preview.progress.sequence + 1,
                  phase: "preparing",
                  stage,
                };
            },
            onPose: (poses) => {
              for (const p of poses) baseMatrices.set(p.id, p.matrix);
              publish("initializing", 0, poses);
            },
          });
          inputEntities = initialized.entities;
          preview.initialization = {
            anchorId: initialized.anchorId,
            fits: initialized.fits,
          };
        }
        const prepared = await prepareGlobalAlignmentInput(inputEntities, {
          entityIds: preview.entityIds,
          ...preview.settings,
          signal: preview.controller.signal,
          check,
          onProgress: (n, stage) => {
            context.progress(n, stage);
            if (preview.progress)
              preview.progress = {
                ...preview.progress,
                sequence: preview.progress.sequence + 1,
                phase: "preparing",
                stage,
              };
          },
        });
        let released = false;
        const releaseOnce = () => {
          if (released) return;
          released = true;
          prepared.release();
        };
        let result: Registration;
        try {
          check();
          const sceneClocks = environment?.sceneClocks;
          if (sceneClocks !== undefined) {
            const clocks = prepared.input.scans.map(({ id }) => {
              const stream = sceneClocks.get(id);
              if (!Array.isArray(stream))
                throw Error(`Missing global alignment clock stream for ${id}.`);
              const copy = Array.from(stream);
              if (
                copy.some(
                  (seed) =>
                    !Number.isInteger(seed) ||
                    seed < -0x80000000 ||
                    seed > 0xffffffff,
                )
              )
                throw Error(`Invalid global alignment clock stream for ${id}.`);
              return copy;
            });
            prepared.input.clocks = clocks;
          }
          const clock = environment?.clock;
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
              onProgress: (n, stage) => {
                context.progress(n, stage);
                if (preview.progress)
                  preview.progress = { ...preview.progress, stage };
              },
              onInputConsumed: releaseOnce,
              onPose: (pass, ordered) =>
                publish(
                  "refining",
                  pass,
                  ordered.map((p) => ({
                    id: p.id,
                    matrix: composeCloudPose(p.matrix, baseMatrices.get(p.id)!),
                  })),
                ),
              localTolerance: 0.001,
              coverageTolerance: 0.05,
              ...(clock === undefined ? {} : { clock }),
            },
          );
          check();
        } finally {
          releaseOnce();
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
        if (initialization === "automatic") {
          const nativeBases = new Map(baseMatrices);
          for (const a of result.outer.applications)
            nativeBases.set(
              a.id,
              composeCloudPose(a.matrix, nativeBases.get(a.id)!),
            );
          const anchorBase = nativeBases.get(preview.initialization!.anchorId)!;
          const surfaceCandidates = Object.fromEntries(
            preview.initialization!.fits.map((f) => [
              f.id,
              [
                composeCloudPose(
                  composeCloudPose(anchorBase, f.matrix),
                  nativeGlobalInvertRigid(nativeBases.get(f.id)!),
                ),
              ],
            ]),
          );
          context.progress(0.9, "Fitting complete scan surfaces");
          const finished = await refineGlobalSurfaceAlignment(result.entities, {
            signal: preview.controller.signal,
            check,
            parallel: preview.settings.parallel,
            surfaceDistance: Math.abs(searchTolerance),
            anchorId: preview.initialization!.anchorId,
            surfaceCandidates,
            onPose: (poses) => {
              publish(
                "refining",
                result.outer.passes + 1,
                poses.map((p) => ({
                  id: p.id,
                  matrix: composeCloudPose(p.matrix, nativeBases.get(p.id)!),
                })),
              );
              if (preview.progress)
                preview.progress.stage = "Fitting complete scan surfaces";
            },
            onProgress: (_n, stage) => {
              context.progress(0.95, stage);
              if (preview.progress)
                preview.progress = {
                  ...preview.progress,
                  sequence: preview.progress.sequence + 1,
                  stage,
                };
            },
          });
          check();
          preview.surfaceRefinement = {
            anchorId: finished.anchorId,
            order: finished.order,
            fits: finished.fits,
          };
          result = { ...result, entities: finished.entities };
        }
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
          if (preview.ownsPoseDisplay) {
            host.showGlobalAlignmentProgress?.(null);
            preview.ownsPoseDisplay = false;
          }
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
        const output = preview.output!;
        releaseGlobalAlignmentPreview(host);
        host.commit(output, "Global Fine Align");
        host.setInterface?.({ globalAlignmentOpen: false });
      });
      return {
        applied: true,
        entityIds: state.entityIds,
        diagnostics: state.diagnostics,
        inputSummary: state.inputSummary,
        settings: state.settings,
        initialization: state.initialization,
        surfaceRefinement: state.surfaceRefinement,
        coordinateStages: state.coordinateStages,
        outer: state.outer,
        converged: state.converged,
      };
    },
  };
}
