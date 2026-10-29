import type { Handler, WorkspaceHost, CommandContext } from "./api";
import type { Entity } from "../types";
import {
  bindScanPreview,
  type ScanPreviewParameters,
} from "../scan-preview-request";
import { scaledMeshCopy, mirroredMeshCopy } from "../scan-scaled-copy";
import { validatePositions } from "../io";
import { processMesh, type ProcessingResult } from "../processing-client";
import { scanMeshCopy } from "../scan-mesh-copy";
import { releaseProcessingPreview } from "../processing-session";
import { retainIndexedMesh } from "../indexed-mesh";
const LEASE_MS = 60_000;
const owners = new WeakMap<WorkspaceHost, (previewId?: string) => void>();
const validators = new WeakMap<WorkspaceHost, () => boolean>();
export function validateScanPreviewOperation(host: WorkspaceHost) {
  return validators.get(host)?.() ?? false;
}
export function releaseScanPreviewOperation(
  host: WorkspaceHost,
  previewId?: string,
) {
  owners.get(host)?.(previewId);
}
/** One bounded, disposable preview per editor. The original is never adopted during preview. */
export function createScanPreviewOperation(host: WorkspaceHost): Handler {
  let current:
    | {
        id: string;
        source: Entity;
        references: Entity[];
        output: Float32Array;
        diagnostics: ProcessingResult["diagnostics"];
        summary: string;
        settings: ScanPreviewParameters;
        comparison?: ProcessingResult["noiseComparison"];
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  function release(previewId?: string) {
    const preview = current;
    if (!preview || (previewId !== undefined && preview.id !== previewId))
      return;
    current = undefined;
    clearTimeout(preview.timer);
    host.clearScanPreview?.(preview.id);
    // Only release the worker's matching immutable preview; never adopt its output.
    releaseProcessingPreview(preview.source.positions, preview.id);
  }
  function present() {
    if (current)
      host.showScanPreview?.({
        id: current.id,
        entityId: current.source.id,
        source: current.source.positions,
        output: current.output,
        summary: current.summary,
        settings: current.settings,
        comparison: current.comparison,
      });
  }
  owners.set(host, release);
  validators.set(host, () => {
    if (!current) return false;
    const entities = host.snapshot().entities;
    if (
      entities.find((e) => e.id === current!.source.id) !== current.source ||
      current.references.some(
        (reference) =>
          entities.find((e) => e.id === reference.id) !== reference,
      )
    ) {
      release();
      return false;
    }
    return true;
  });
  return async (args, c: CommandContext) => {
    c.check();
    if (args.action === "cancel") {
      if (current && args.previewId !== current.id)
        throw Error("Unknown ShrinkWrap preview.");
      release();
      return { cancelled: true };
    }
    const state = host.snapshot();
    const source = state.entities.find((e) => e.id === args.entityId);
    if (
      !source ||
      source.locked ||
      !source.visible ||
      source.kind !== "mesh" ||
      source.kernelId ||
      source.parametric
    )
      throw Error("ShrinkWrap requires a visible, unlocked raw mesh source.");
    if (args.action === "create") {
      if (
        !args.operation ||
        ![
          "shrinkwrap",
          "reduceNoise",
          "reducePolygons",
          "scaleMesh",
          "mirrorMesh",
        ].includes(args.operation.kind)
      )
        throw Error("This tool does not support mesh preview.");
      if (
        "selection" in args.operation ||
        "targets" in args.operation ||
        "targetIds" in args.operation
      )
        throw Error("Inner geometry must refer to workspace objects.");
      if (args.targetIds !== undefined && args.operation.kind !== "shrinkwrap")
        throw Error("Preview targetIds are supported only for ShrinkWrap.");
      const settings = {
        ...args.operation,
        ...(args.operation.kind === "shrinkwrap"
          ? { targetIds: args.targetIds }
          : {}),
      } as ScanPreviewParameters;
      const operation = bindScanPreview(
        source,
        settings,
        state.entities,
        state.selectedId === source.id ? state.selection : undefined,
      );
      release();
      const previewId = crypto.randomUUID();
      const result = await processMesh(
        {
          kind: "scanPreview",
          phase: "create",
          positions: source.positions,
          previewId,
          operation,
        },
        { signal: c.signal, onProgress: c.progress, reuseTopology: true },
      );
      try {
        c.check();
      } catch (error) {
        releaseProcessingPreview(source.positions, previewId);
        throw error;
      }
      if (!result.positions)
        throw Error("ShrinkWrap preview returned no geometry.");
      const timer = setTimeout(() => release(previewId), LEASE_MS);
      if (typeof timer === "object" && "unref" in timer) timer.unref();
      current = {
        id: previewId,
        source,
        references: (settings.kind === "mirrorMesh" &&
        settings.plane === "object"
          ? [settings.referenceId]
          : (args.targetIds ?? [])
        ).map((id: string) => state.entities.find((e) => e.id === id)!),
        output: result.positions,
        diagnostics: result.diagnostics,
        summary: String(result.diagnostics.summary ?? "ShrinkWrap preview"),
        settings,
        timer,
      };
      if (c.mutate) c.mutate(present);
      else present();
      return {
        previewId,
        entityId: source.id,
        triangles: result.positions.length / 9,
        expiresInMs: LEASE_MS,
        diagnostics: result.diagnostics,
        topology: result.topology,
      };
    }
    const preview = current;
    if (
      !preview ||
      args.previewId !== preview.id ||
      preview.source.id !== source.id
    )
      throw Error("ShrinkWrap preview expired; create a new preview.");
    if (
      source !== preview.source ||
      preview.references.some(
        (reference) =>
          state.entities.find((e) => e.id === reference.id) !== reference,
      )
    ) {
      release();
      throw Error(
        "ShrinkWrap source or references changed; create a new preview.",
      );
    }
    if (args.action === "compare") {
      const deviation = args.deviation ?? 0.1;
      const result = await processMesh(
        {
          kind: "scanPreview",
          phase: "compare",
          positions: source.positions,
          previewId: preview.id,
          deviation,
          paletteThreshold: args.paletteThreshold ?? deviation,
          displayRange:
            args.displayRange ??
            (preview.settings.kind === "reducePolygons"
              ? deviation
              : undefined),
        },
        { signal: c.signal, onProgress: c.progress, reuseTopology: true },
      );
      c.check();
      if (current !== preview)
        throw Error(
          "ShrinkWrap preview expired during comparison; create a new preview.",
        );
      if (!result.noiseComparison)
        throw Error("ShrinkWrap comparison returned no measurements.");
      preview.comparison = result.noiseComparison;
      preview.summary = String(result.diagnostics.summary);
      if (c.mutate) c.mutate(present);
      else present();
      return {
        previewId: preview.id,
        diagnostics: result.diagnostics,
        statistics: result.noiseComparison.statistics,
      };
    }
    if (args.action !== "accept")
      throw Error("Choose create, compare, accept or cancel.");
    validatePositions(preview.output);
    const kind = preview.settings.kind;
    const title = {
      shrinkwrap: "ShrinkWrap",
      reduceNoise: "Reduce noise",
      reducePolygons: "Reduce polygons",
      scaleMesh: "Scale mesh",
      mirrorMesh: "Mirror mesh",
    }[kind];
    const copy = args.createNew
      ? kind === "scaleMesh"
        ? scaledMeshCopy(source, preview.output, crypto.randomUUID())
        : kind === "mirrorMesh"
          ? mirroredMeshCopy(source, preview.output, crypto.randomUUID())
          : scanMeshCopy(source, crypto.randomUUID(), preview.output)
      : {
          ...source,
          positions: preview.output,
          normals: undefined,
          edgePositions: undefined,
          indexedMesh: undefined,
          fit: undefined,
          planeFrame: undefined,
          scanSource: undefined,
          surfacePatch: undefined,
          surfaceScanId: undefined,
          meshSelection:
            kind === "reduceNoise" ? source.meshSelection : undefined,
        };
    if (args.createNew && kind !== "scaleMesh" && kind !== "mirrorMesh")
      copy.name = `${source.name} — ${title}`;
    const entities = args.createNew
      ? [...state.entities, copy]
      : state.entities.map((e) => (e.id === source.id ? copy : e));
    // Preview cleanup can synchronously update React's selection state after the
    // source geometry changes. Track that owned transition with the commit so a
    // second guard cannot report a conflict after geometry was already adopted.
    const write = () => {
      host.commit(
        entities.map(retainIndexedMesh),
        title,
        !args.createNew && kind === "reduceNoise"
          ? { preserveFacetSelectionFor: source.id }
          : undefined,
      );
      release();
      host.select(copy.id);
    };
    if (c.mutate) c.mutate(write);
    else {
      c.check();
      write();
    }
    return {
      entityId: copy.id,
      triangles: copy.positions.length / 9,
      diagnostics: preview.diagnostics,
      accepted: true,
    };
  };
}
