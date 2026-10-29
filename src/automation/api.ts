import {
  releaseInspectionDisplay,
  type InspectionDisplay,
} from "./inspection-operations";
import type { ImportBatchProgress } from "../import-batch";
import {
  validateScanPreviewOperation,
  releaseScanPreviewOperation,
} from "./scan-preview-operations";
import { releaseInteractiveSession } from "./interactive-alignment-operations";
import {
  disposeReferenceConstructionPreview,
  inspectReferenceConstructionPreview,
} from "./reference-construction-preview";
import type { InteractiveAlignmentState } from "../interactive-alignment-session";
import type { InteractiveDragInput } from "../interactive-alignment-math";
import type { InteractivePointerDrag } from "../interactive-camera";
import type { InteractiveMirrorBackend } from "../interactive-mirror-backend";
import catalog from "./catalog.json";
import {
  diskBackedBlob,
  DISK_BLOB_BLOCK_BYTES,
} from "../transient-blob-storage";
import { cloudPlacement } from "../point-cloud-placement";
import { releaseDatumPreview } from "./datum-preview-resources";
import {
  inspectGlobalAlignmentPreview,
  releaseGlobalAlignmentPreview,
  validateGlobalAlignmentPreview,
} from "./global-alignment-operations";
import {
  selectionProcessingMode,
  type SelectionProcessingMode,
} from "../selection-processing-mode";
import type { CadClient } from "../cad/client";
import type { Revision } from "../history";
import type { Sketch } from "../sketch";
import type { Entity, Project } from "../types";
import {
  VisualCaptureError,
  type VisualCaptureOptions,
  type CapturedImage,
} from "./visual-capture";
import type { InterfacePatch, ViewportCommand } from "./workflow-operations";
import type { ObjectSelectionModifiers } from "../object-selection";
import type { HoleFillProgress } from "../hole-fill-progress";
import type {
  LandmarkEdit,
  LandmarkPreviewOptions,
  LandmarkTargetScope,
} from "../landmark-alignment";

export interface WorkspaceSnapshot {
  projectId?: string;
  name: string;
  entities: Entity[];
  history: Revision[];
  future: Revision[];
  authoring: NonNullable<Project["authoring"]>;
  selectedId: string | null;
  selectedIds?: string[];
  selectionAnchorId?: string | null;
  selection: Uint8Array | null;
  sketchDraft?: Sketch;
  settings: Record<string, unknown>;
}
export interface WorkspaceHost {
  showMeasurement?(
    measurement: import("../inspection").MeasurementInput | null,
  ): void;
  showSection?(
    section: { entityId: string; axis: "x" | "y" | "z"; offset: number } | null,
  ): void;
  showInspection?(display: InspectionDisplay | null): void;
  inspectScanSelection?(): unknown;
  controlScanSelection?(
    command: import("./scan-selection-operations").ScanSelectionControl,
  ): void;
  selectScanRegion?(
    entityId: string,
    region: import("../screen-selection").ScreenRegion,
    through: boolean,
    signal: AbortSignal,
  ): Promise<Uint8Array>;
  installInteractiveMirror?(backend: InteractiveMirrorBackend | null): void;
  publishInteractive?(state: InteractiveAlignmentState | null): void;
  inspectInteractive?(): InteractiveAlignmentState | null;
  interactiveDragInput?(
    input: InteractivePointerDrag,
  ): InteractiveDragInput | null;
  interactiveViewFrame?(): { matrix: number[]; anchor: number[] };
  finishInteractiveCurrentView?(): void;
  previewLandmarks?(options: LandmarkPreviewOptions): Promise<unknown>;
  acceptLandmarks?(): unknown;
  inspectLandmarks?(): unknown;
  editLandmarks?(
    edit:
      | LandmarkEdit
      | {
          action: "begin";
          movingId: string;
          fixedId?: string;
          targetScope?: LandmarkTargetScope;
        },
  ): unknown;
  inspectCommands?(): unknown;
  launchCommand?(name?: string): unknown;
  snapshot(): WorkspaceSnapshot;
  cad(): CadClient;
  commit(
    entities: Entity[],
    label: string,
    policy?: import("../object-operations").ModelCommitPolicy,
  ): void;
  replace(
    project: Project,
    cad?: CadClient,
    session?: { history: Revision[]; future: Revision[]; projectId?: string },
  ): void;
  select(id: string | null, modifiers?: ObjectSelectionModifiers): void;
  present?(signal?: AbortSignal): Promise<void>;
  showDatumPreview?(entities: Entity[] | null): void;
  showReferenceConstructionPreview?(
    owner: string,
    candidate:
      | import("../reference-construction-session").ReferenceConstructionCachedPreview
      | null,
  ): void;
  showScanPreview?(
    preview: {
      id: string;
      entityId: string;
      source: Entity["positions"];
      output: Float32Array;
      summary: string;
      settings: import("../scan-preview-request").ScanPreviewParameters;
      comparison?: NonNullable<
        import("../processing-client").ProcessingResult["noiseComparison"]
      >;
    } | null,
  ): void;
  clearScanPreview?(previewId: string): void;
  setSelection(entityId: string, mask: Uint8Array): void;
  setSketch(sketch: Sketch): void;
  /** Current authoring edit session only; never traverses model history. */
  stepSketchHistory?(repeat: boolean): boolean;
  setAuthoring?(authoring: NonNullable<Project["authoring"]>): void;
  undo(): void;
  redo(): void;
  view(view: string): void;
  settings(patch: Record<string, unknown>): void;
  busy(): boolean;
  activity(
    busy: boolean,
    message: string,
    selectionMode?: SelectionProcessingMode,
  ): void;
  deleteBackup?(id: string): Promise<void>;
  inspectApplication?(maxControls: number): unknown;
  setInterface?(patch: InterfacePatch): void;
  inspectViewport?(view?: ViewportCommand["view"]): unknown;
  inspectSpaceMouse?(): unknown;
  controlSpaceMouse?(
    command: import("../spacemouse").SpaceMouseCommand,
    signal: AbortSignal,
  ): Promise<unknown>;
  controlViewport?(command: ViewportCommand): void;
  pickViewport?(
    x: number,
    y: number,
    maxHits: number,
    view?: ViewportCommand["view"],
  ): unknown;
  captureScreenshot?(
    options: VisualCaptureOptions,
    signal: AbortSignal,
  ): Promise<CapturedImage>;
  renameProject?(name: string): void;
  discardPreview?(
    target:
      | "scan"
      | "surface"
      | "landmarks"
      | "sketchSection"
      | "datum"
      | "globalAlignment"
      | "interactive",
  ): void;
}
export interface ArtifactInfo {
  artifactId: string;
  name: string;
  mime: string;
  bytes: number;
}
export interface CommandContext {
  /** API-owned operation identity; retained previews may outlive the job receipt. */
  jobId?: string;
  signal: AbortSignal;
  progress(
    fraction: number,
    stage: string,
    details?: HoleFillProgress | ImportBatchProgress,
  ): void;
  check(): void;
  /** Check the revision, apply an owned synchronous write, then track its revision. */
  mutate?(write: () => void): void;
  artifact(
    data: Blob | Uint8Array | string,
    name: string,
    mime: string,
  ): ArtifactInfo;
  artifactBlob(id: string): Blob;
}
// JSON input is validated against the published schema before reaching a handler.
// Domain validators remain authoritative for geometry/sketch/recipe invariants.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler = (
  args: Record<string, any>,
  context: CommandContext,
) => unknown | Promise<unknown>;
export type ApiResult =
  | { ok: true; revision: number; result: unknown }
  | {
      ok: false;
      revision: number;
      error: { code: string; message: string };
    };
type Schema = Record<string, any>;
export const ARTIFACT_BYTES = 1024 * 1024 * 1024;
const ARTIFACT_COUNT = 64;
const ARTIFACT_CHUNK_BYTES = 1024 * 1024;
const ARTIFACT_LEASE_MS = 900000;
function discoveryKeywords(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(discoveryKeywords);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) => [
    ...(key === "description" && typeof entry === "string" ? [entry] : []),
    ...(key === "enum" && Array.isArray(entry)
      ? entry.filter((item): item is string => typeof item === "string")
      : []),
    ...(key === "properties" && entry && typeof entry === "object"
      ? Object.keys(entry)
      : []),
    ...discoveryKeywords(entry),
  ]);
}
const discoveryIndex = catalog.map((tool) => ({
  tool,
  text: [tool.name, tool.description, ...discoveryKeywords(tool.inputSchema)]
    .join(" ")
    .toLowerCase(),
}));
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Runtime validation uses the very same JSON Schemas advertised through MCP. */
export function validateInput(
  schema: Schema,
  value: unknown,
  path = "arguments",
): void {
  const fail = (reason: string): never => {
    throw new ApiError("INVALID_ARGUMENT", `${path}: ${reason}`);
  };
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((item: Schema) => {
      try {
        validateInput(item, value, path);
        return true;
      } catch {
        return false;
      }
    });
    if (matches.length !== 1) fail("must match exactly one supported variant");
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) fail("unsupported value");
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail("must be an object");
    const object = value as Record<string, unknown>;
    if (
      schema.minProperties !== undefined &&
      Object.keys(object).length < schema.minProperties
    )
      fail("too few fields");
    for (const key of schema.required ?? [])
      if (!(key in object)) fail(`missing ${key}`);
    for (const [key, entry] of Object.entries(object)) {
      if (schema.properties?.[key])
        validateInput(schema.properties[key], entry, `${path}.${key}`);
      else if (schema.additionalProperties === false)
        fail(`unknown field ${key}`);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) fail("must be an array");
    const list = value as unknown[];
    if (schema.minItems !== undefined && list.length < schema.minItems)
      fail("too few items");
    if (schema.maxItems !== undefined && list.length > schema.maxItems)
      fail("too many items");
    if (
      schema.uniqueItems &&
      new Set(list.map((item) => JSON.stringify(item))).size !== list.length
    )
      fail("duplicate items");
    if (schema.items)
      list.forEach((item, i) =>
        validateInput(schema.items, item, `${path}[${i}]`),
      );
  } else if (schema.type === "string") {
    if (typeof value !== "string") fail("must be a string");
    const text = value as string;
    if (schema.minLength !== undefined && text.length < schema.minLength)
      fail("too short");
    if (schema.maxLength !== undefined && text.length > schema.maxLength)
      fail("too long");
    if (schema.pattern && !new RegExp(schema.pattern).test(text))
      fail("invalid format");
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value))
      fail("must be finite");
    const number = value as number;
    if (schema.type === "integer" && !Number.isSafeInteger(number))
      fail("must be a safe integer");
    if (schema.minimum !== undefined && number < schema.minimum)
      fail("below minimum");
    if (
      schema.exclusiveMinimum !== undefined &&
      number <= schema.exclusiveMinimum
    )
      fail("must exceed minimum");
    if (schema.maximum !== undefined && number > schema.maximum)
      fail("above maximum");
  } else if (schema.type === "boolean" && typeof value !== "boolean")
    fail("must be boolean");
}

interface Job {
  jobId: string;
  command: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  stage: string;
  progressDetails?: HoleFillProgress | ImportBatchProgress;
  result?: unknown;
  error?: { code: string; message: string };
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
}

/** One gateway for UI and MCP; no network, React, or native handles in its wire contract. */
export class ApplicationApi {
  readonly apiVersion = "1.0";
  private revision = 0;
  private stateKey?: string;
  private identities = new WeakMap<object, number>();
  private nextIdentity = 0;
  private requests = new Map<
    string,
    { key: string; promise: Promise<ApiResult> }
  >();
  private jobs = new Map<string, Job>();
  private artifacts = new Map<
    string,
    { info: ArtifactInfo; blob: Blob; used: number }
  >();
  private active?: Job;
  private disposed = false;
  private ownerDetached = false;
  private ownerLeased = false;
  private ownerGeneration = 0;
  private ownerEpoch = 0;
  constructor(
    private host: WorkspaceHost,
    private handlers: Record<string, Handler>,
  ) {}

  /** React may synchronously replay cleanup/setup while retaining this gateway. */
  retainOwner(): () => void {
    if (this.disposed) throw new Error("Application API has been disposed.");
    if (this.ownerLeased)
      throw new Error("Application API already has an owner.");
    const generation = ++this.ownerGeneration;
    this.ownerLeased = true;
    this.ownerDetached = false;
    let released = false;
    return () => {
      if (released || generation !== this.ownerGeneration) return;
      released = true;
      this.ownerLeased = false;
      this.ownerDetached = true;
      this.ownerEpoch++;
      this.cancelActive();
      try {
        this.releasePreviews();
      } finally {
        queueMicrotask(() => {
          if (generation !== this.ownerGeneration || !this.ownerDetached)
            return;
          this.disposed = true;
          this.artifacts.clear();
          this.requests.clear();
        });
      }
    };
  }

  private checkOwner(epoch: number) {
    if (this.disposed || this.ownerDetached || epoch !== this.ownerEpoch)
      throw new ApiError("DISCONNECTED", "Workspace owner closed.");
  }

  currentRevision() {
    const next = this.host.snapshot();
    // Camera/layout measurements can change while a geometry job is running.
    const { scale, effectiveGridSpacing, ...settings } = next.settings;
    const identity = (value?: object | null) => {
      if (!value) return 0;
      if (!this.identities.has(value))
        this.identities.set(value, ++this.nextIdentity);
      return this.identities.get(value);
    };
    const key = JSON.stringify({
      name: next.name,
      entities: next.entities.map((e) => [
        e.id,
        e.name,
        e.kind,
        e.constructionOrderKey,
        identity(e.reference),
        e.color,
        e.pointSize,
        e.pointAutoDensity,
        e.pointDensity,
        e.pointColorMode,
        e.opacity,
        e.visible,
        e.locked,
        e.selectable,
        e.kernelId,
        identity(cloudPlacement(e)?.sourcePositions ?? e.positions),
        identity(e.pointColors),
        e.ascAttributes,
        cloudPlacement(e)?.matrixBits,
        identity(e.surfacePatch),
        identity(e.parametric),
        identity(e.authoringLinks),
        identity(e.meshSelection),
        identity(e.planeFrame),
        identity(e.fit),
      ]),
      history: next.history.map((r) => r.label),
      future: next.future.map((r) => r.label),
      selectedId: next.selectedId,
      selectedIds: next.selectedIds,
      selectionAnchorId: next.selectionAnchorId,
      selection: identity(next.selection),
      sketch: identity(next.authoring.sketch),
      draft: identity(next.sketchDraft),
      sketches: next.authoring.sketches?.map((s) => [
        s.id,
        s.name,
        s.kind === "spatial" ? identity(s.curves) : identity(s.sketch),
        s.visible,
      ]),
      activeSketchId: next.authoring.activeSketchId,
      inspections: next.authoring.inspections,
      settings,
    });
    if (this.stateKey !== undefined && key !== this.stateKey) this.revision++;
    this.stateKey = key;
    return this.revision;
  }

  discardScanPreview(previewId?: string) {
    releaseScanPreviewOperation(this.host, previewId);
  }
  validateScanPreview() {
    return validateScanPreviewOperation(this.host);
  }
  validateGlobalAlignmentPreview() {
    return validateGlobalAlignmentPreview(this.host);
  }
  inspectGlobalAlignmentPreview() {
    return inspectGlobalAlignmentPreview(this.host);
  }
  /** Shared admission for GUI producers and MCP preview commands. */
  requireReferencePreviewIdle() {
    const reference = inspectReferenceConstructionPreview(this.host);
    const application = this.host.inspectApplication?.(0) as
      { previews?: { referenceConstruction?: boolean } } | undefined;
    if (
      reference.active ||
      ("cleanupPending" in reference && reference.cleanupPending) ||
      application?.previews?.referenceConstruction
    )
      throw new ApiError(
        "BUSY",
        "Finish or discard the reference construction preview before starting another preview.",
      );
  }
  async invoke(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<ApiResult> {
    try {
      if (this.disposed || this.ownerDetached)
        throw new ApiError(
          "DISCONNECTED",
          "Application API has been disposed.",
        );
      const descriptor = catalog.find((item) => item.name === command);
      if (!descriptor)
        throw new ApiError("UNKNOWN_COMMAND", `Unknown command: ${command}`);
      validateInput(descriptor.inputSchema, args);
      const key = JSON.stringify([command, canonical(args)]);
      const requestId = args.requestId as string | undefined;
      if (requestId && this.requests.has(requestId)) {
        const prior = this.requests.get(requestId)!;
        if (prior.key !== key)
          throw new ApiError(
            "REQUEST_CONFLICT",
            "requestId was already used with different arguments.",
          );
        return prior.promise;
      }
      const promise = this.execute(
        command,
        args,
        descriptor.readOnly,
        descriptor.job ?? false,
      );
      if (requestId) {
        this.requests.set(requestId, { key, promise });
        // Bounded retry receipts; IDs older than this window must not be retried.
        if (this.requests.size > 256)
          this.requests.delete(this.requests.keys().next().value!);
      }
      return await promise;
    } catch (error) {
      return this.failure(error);
    }
  }

  private async execute(
    command: string,
    args: Record<string, unknown>,
    readOnly: boolean,
    asynchronous: boolean,
  ): Promise<ApiResult> {
    try {
      const ownerEpoch = this.ownerEpoch;
      let startRevision = this.currentRevision();
      if (!readOnly && args.expectedRevision !== startRevision)
        throw new ApiError(
          "REVISION_CONFLICT",
          "Workspace changed; inspect project_get and use its current revision with a new requestId.",
        );
      if (
        [
          "alignment_preview",
          "global_alignment_preview",
          "landmark_preview",
        ].includes(command) ||
        (command === "scan_preview" && args.action === "create") ||
        (command === "interactive_alignment_edit" && args.action === "begin") ||
        (command === "landmark_edit" &&
          !["reset", "clear", "view-layout"].includes(String(args.action)))
      )
        this.requireReferencePreviewIdle();
      if (command === "global_alignment_cancel") {
        const scoped = args.jobId !== undefined;
        const ownsActive =
          this.active?.command === "global_alignment_preview" &&
          (!scoped || this.active.jobId === args.jobId);
        if (ownsActive) this.active?.controller.abort();
        const released = releaseGlobalAlignmentPreview(
          this.host,
          scoped ? { jobId: args.jobId as string } : undefined,
        );
        if (!scoped || released)
          this.host.setInterface?.({ globalAlignmentOpen: false });
        return this.success({ cancelled: !scoped || ownsActive || released });
      }
      if (command === "preview_discard") {
        // The renderer is shared with coordinate alignment. Global cancellation
        // must release only its own lease, including when no global preview exists.
        if (args.target === "globalAlignment") {
          if (this.active?.command === "global_alignment_preview")
            this.active.controller.abort();
          releaseGlobalAlignmentPreview(this.host);
          this.host.setInterface?.({ globalAlignmentOpen: false });
          return this.success({
            target: args.target,
            cancellationRequested: true,
            committedGeometryPreserved: true,
            note: "Global alignment and its owning API job are cancelled; committed geometry is preserved.",
          });
        }
        if (args.target !== "interactive" && this.host.inspectInteractive?.())
          throw new ApiError(
            "BUSY",
            "Cancel Interactive alignment before discarding another preview.",
          );
        if (args.target !== "interactive" && !this.host.discardPreview)
          throw new ApiError(
            "UNSUPPORTED",
            "GUI preview cancellation is unavailable.",
          );
        if (args.target !== "interactive")
          this.host.discardPreview!(
            args.target as
              | "scan"
              | "surface"
              | "landmarks"
              | "sketchSection"
              | "datum"
              | "globalAlignment",
          );
        if (
          args.target === "landmarks" &&
          this.active?.command === "landmark_preview"
        )
          this.active.controller.abort();
        if (args.target === "scan") {
          if (this.active?.command === "scan_preview")
            this.active.controller.abort();
          this.discardScanPreview();
        }
        if (args.target === "datum") {
          if (this.active?.command === "global_alignment_preview")
            this.active.controller.abort();
          releaseGlobalAlignmentPreview(this.host);
        }
        if (args.target === "datum") await releaseDatumPreview(this.host);
        this.checkOwner(ownerEpoch);
        if (args.target === "interactive") {
          if (this.active?.command.startsWith("interactive_alignment_"))
            this.active.controller.abort();
          releaseInteractiveSession(this.host);
        }
        return this.success({
          target: args.target,
          cancellationRequested: true,
          committedGeometryPreserved: true,
          note:
            args.target === "interactive"
              ? "Interactive alignment and its owning API job are cancelled; committed geometry is preserved."
              : args.target === "landmarks"
                ? "Any owning landmark preview job is cancelled; unrelated API jobs require job_cancel."
                : "GUI workers retain their cancellation/cleanup lifecycle. API jobs are cancelled separately through job_cancel.",
        });
      }
      if (command === "tools_search") {
        const terms = String(args.query ?? "")
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean);
        const matches = discoveryIndex
          .filter((entry) => terms.every((term) => entry.text.includes(term)))
          .map((entry) => entry.tool);
        return this.success({
          total: matches.length,
          tools: matches
            .slice(0, (args.limit as number) ?? 12)
            .map(({ name, description, readOnly, job, inputSchema }) => ({
              name,
              description,
              readOnly,
              job: job ?? false,
              ...(args.includeSchemas ? { inputSchema } : {}),
            })),
        });
      }
      if (command === "session_get") {
        this.sweepArtifacts();
        return this.success({
          busy: this.host.busy(),
          activeJobId: this.active?.jobId ?? null,
          jobs: [...this.jobs.values()].map(
            ({
              jobId,
              command,
              status,
              progress,
              stage,
              error,
              controller,
            }) => ({
              jobId,
              command,
              status,
              progress,
              stage,
              error,
              cancellationRequested: controller.signal.aborted,
            }),
          ),
          artifacts: [...this.artifacts.values()].map(({ info, used }) => ({
            ...info,
            expiresAt: new Date(used + ARTIFACT_LEASE_MS).toISOString(),
          })),
          retainedRequestCount: this.requests.size,
        });
      }
      if (command === "capabilities_get")
        return this.success({
          apiVersion: this.apiVersion,
          commands: catalog,
          limits: {
            retainedRequests: 256,
            retainedJobs: 32,
            artifactBytes: ARTIFACT_BYTES,
            artifactCount: ARTIFACT_COUNT,
            artifactChunkBytes: ARTIFACT_CHUNK_BYTES,
            artifactLeaseSeconds: ARTIFACT_LEASE_MS / 1000,
          },
          connection: "browser-owned workspace; no headless runtime",
        });
      if (command === "job_get") {
        const job = this.jobs.get(args.jobId as string);
        if (!job)
          throw new ApiError(
            "NOT_FOUND",
            "Job not retained in this workspace.",
          );
        const { controller: _controller, timer: _timer, ...info } = job;
        return this.success(info);
      }
      if (command === "job_cancel") {
        const job = this.jobs.get(args.jobId as string);
        if (!job)
          throw new ApiError(
            "NOT_FOUND",
            "Job not retained in this workspace.",
          );
        if (job.status === "running") {
          job.controller.abort();
          job.stage =
            "Cancellation requested; waiting for native work to settle";
        }
        return this.success({
          jobId: job.jobId,
          status: job.status,
          cancellationRequested: job.controller.signal.aborted,
        });
      }
      if (command === "artifact_put") {
        this.sweepArtifacts();
        const encoded = args.base64 as string;
        if (
          encoded.length > 1400000 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            encoded,
          )
        )
          throw new ApiError(
            "INVALID_ARGUMENT",
            "Invalid base64 chunk (maximum 1 MiB decoded).",
          );
        const data = Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0));
        if (data.byteLength > ARTIFACT_CHUNK_BYTES)
          throw new ApiError(
            "RESOURCE_LIMIT",
            "Upload chunks cannot exceed 1 MiB decoded.",
          );
        let blob = new Blob([data]);
        let priorEntry: ReturnType<ApplicationApi["getArtifact"]> | undefined;
        if (args.artifactId) {
          const prior = this.artifacts.get(args.artifactId as string);
          if (!prior || prior.info.name !== args.name)
            throw new ApiError(
              "NOT_FOUND",
              "Upload artifact not found or name mismatch.",
            );
          if (args.offset !== prior.blob.size)
            throw new ApiError(
              "UPLOAD_CONFLICT",
              "Chunk offset must equal artifact size.",
            );
          blob = new Blob([prior.blob, data]);
          priorEntry = prior;
        } else if (args.offset !== 0)
          throw new ApiError(
            "UPLOAD_CONFLICT",
            "First chunk offset must be zero.",
          );
        const previousBytes = priorEntry?.blob.size ?? 0;
        if (
          Math.floor(blob.size / DISK_BLOB_BLOCK_BYTES) >
          Math.floor(previousBytes / DISK_BLOB_BLOCK_BYTES)
        ) {
          blob = await diskBackedBlob(blob);
          this.checkOwner(ownerEpoch);
          this.sweepArtifacts();
          if (args.artifactId && !this.artifacts.has(args.artifactId as string))
            throw new ApiError(
              "NOT_FOUND",
              "Upload artifact expired or was deleted.",
            );
          if (
            args.artifactId &&
            this.artifacts.get(args.artifactId as string) !== priorEntry
          )
            throw new ApiError(
              "UPLOAD_CONFLICT",
              "Upload changed while its chunk was stored; retry from the current size.",
            );
        }
        const result = this.storeArtifact(
          blob,
          args.name as string,
          "application/octet-stream",
          args.artifactId as string | undefined,
        );
        return this.success(result);
      }
      if (command === "artifact_read") {
        const entry = this.getArtifact(args.artifactId as string);
        const offset = (args.offset as number) ?? 0;
        if (offset > entry.blob.size)
          throw new ApiError(
            "INVALID_ARGUMENT",
            "Offset exceeds artifact size.",
          );
        const data = new Uint8Array(
          await entry.blob
            .slice(offset, offset + ((args.length as number) ?? 65536))
            .arrayBuffer(),
        );
        this.checkOwner(ownerEpoch);
        const nativeBase64 = (data as Uint8Array & { toBase64?: () => string })
          .toBase64;
        let base64: string;
        if (typeof nativeBase64 === "function")
          base64 = nativeBase64.call(data);
        else {
          // Bound conversion scratch in browsers without native Base64 encoding.
          const text: string[] = [];
          for (let start = 0; start < data.length; start += 8192)
            text.push(
              String.fromCharCode(...data.subarray(start, start + 8192)),
            );
          base64 = btoa(text.join(""));
        }
        return this.success({
          ...entry.info,
          offset,
          base64,
          nextOffset: offset + data.length,
          eof: offset + data.length === entry.blob.size,
        });
      }
      if (command === "artifact_delete") {
        this.artifacts.delete(args.artifactId as string);
        return this.success({ deleted: true });
      }
      if (
        ["alignment_apply", "alignment_preview"].includes(command) &&
        inspectGlobalAlignmentPreview(this.host).state !== "idle"
      )
        throw new ApiError(
          "BUSY",
          "Apply or cancel Global Fine Align before coordinate alignment.",
        );
      if (
        !readOnly &&
        this.host.inspectInteractive?.() &&
        !command.startsWith("interactive_alignment_") &&
        !["viewport_control", "view_set", "settings_set", "ui_set"].includes(
          command,
        )
      )
        throw new ApiError(
          "BUSY",
          "Finish or cancel Interactive alignment before editing the project.",
        );
      const handler = this.handlers[command];
      if (!handler)
        throw new ApiError(
          "UNSUPPORTED",
          "Command is not supported by this application version.",
        );
      const job: Job = {
        jobId: crypto.randomUUID(),
        command,
        status: "running",
        progress: 0,
        stage: "Starting",
        controller: new AbortController(),
        timer: undefined!,
      };
      const createdArtifacts: string[] = [];
      const context: CommandContext = {
        jobId: job.jobId,
        signal: job.controller.signal,
        progress: (fraction, stage, details) => {
          job.progress = Math.max(0, Math.min(1, fraction));
          job.stage = stage;
          job.progressDetails = details;
        },
        check: () => {
          job.controller.signal.throwIfAborted();
          this.checkOwner(ownerEpoch);
          if (this.currentRevision() !== startRevision)
            throw new ApiError(
              "REVISION_CONFLICT",
              "Workspace changed while operation ran; result was not applied.",
            );
        },
        mutate: (write) => {
          context.check();
          write();
          startRevision = this.currentRevision();
        },
        artifact: (data, name, mime) => {
          context.check();
          const artifact = this.storeArtifact(data, name, mime);
          createdArtifacts.push(artifact.artifactId);
          return artifact;
        },
        artifactBlob: (id) => {
          context.check();
          const entry = this.getArtifact(id);
          return new File([entry.blob], entry.info.name, {
            type: entry.info.mime,
          });
        },
      };
      if (readOnly && !asynchronous) {
        const result = await handler(args, context);
        this.checkOwner(ownerEpoch);
        return this.success(result);
      }
      if (this.active || this.host.busy())
        throw new ApiError(
          "BUSY",
          "Workspace is executing an operation; wait for completion or cancel the active job.",
        );
      // Launchers delegate progress and busy ownership to the normal GUI/domain
      // command. Setting API activity here would block that command itself.
      if (command === "command_run" || command === "command_repeat") {
        const result = await handler(args, context);
        this.checkOwner(ownerEpoch);
        return this.success(result);
      }
      // A single admission lane also protects native read operations from concurrent edits.
      this.active = job;
      const fastInteractive =
        command === "interactive_alignment_edit" && args.action !== "begin";
      if (!fastInteractive && command !== "object_select")
        this.host.activity(
          true,
          `Agent/API: ${command}`,
          command === "mesh_process"
            ? selectionProcessingMode(args.operation)
            : "boundary",
        );
      job.timer = setTimeout(
        () =>
          job.controller.abort(
            new DOMException(
              "Application job exceeded its 15-minute lease",
              "AbortError",
            ),
          ),
        900000,
      );
      const run = async () => {
        try {
          job.result = await handler(args, context);
          job.controller.signal.throwIfAborted();
          this.checkOwner(ownerEpoch);
          job.status = "succeeded";
          job.progress = 1;
          job.stage = "Completed";
          return this.success(job.result);
        } catch (error) {
          if (
            command === "landmark_preview" &&
            error instanceof DOMException &&
            error.name === "AbortError"
          )
            job.controller.abort(error);
          for (const artifactId of createdArtifacts)
            this.artifacts.delete(artifactId);
          job.status = job.controller.signal.aborted ? "cancelled" : "failed";
          const failure = this.failure(error);
          job.error = failure.error;
          job.stage = failure.error.message;
          return failure;
        } finally {
          clearTimeout(job.timer);
          this.active = undefined;
          if (!fastInteractive && command !== "object_select")
            this.host.activity(false, `${command}: ${job.status}`);
        }
      };
      if (asynchronous) {
        this.jobs.set(job.jobId, job);
        if (this.jobs.size > 32)
          this.jobs.delete(this.jobs.keys().next().value!);
        void run();
        return this.success({ jobId: job.jobId, status: "running" });
      }
      return await run();
    } catch (error) {
      return this.failure(error);
    }
  }

  private success(result: unknown): ApiResult {
    return { ok: true, revision: this.currentRevision(), result };
  }
  private failure(error: unknown): Extract<ApiResult, { ok: false }> {
    return {
      ok: false,
      revision: this.currentRevision(),
      error: {
        code:
          error instanceof ApiError || error instanceof VisualCaptureError
            ? error.code
            : error instanceof DOMException && error.name === "AbortError"
              ? "CANCELLED"
              : "OPERATION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  private sweepArtifacts() {
    for (const [id, item] of this.artifacts)
      if (Date.now() - item.used > ARTIFACT_LEASE_MS) this.artifacts.delete(id);
  }
  private getArtifact(id: string) {
    this.sweepArtifacts();
    const item = this.artifacts.get(id);
    if (!item)
      throw new ApiError("NOT_FOUND", "Artifact expired or not found.");
    item.used = Date.now();
    return item;
  }
  private storeArtifact(
    data: Blob | Uint8Array | string,
    name: string,
    mime: string,
    id: string = crypto.randomUUID(),
  ): ArtifactInfo {
    this.sweepArtifacts();
    const blob =
      data instanceof Blob
        ? data
        : typeof data === "string"
          ? new Blob([data], { type: mime })
          : new Blob([new Uint8Array(data)], { type: mime });
    const used = [...this.artifacts.entries()].reduce(
      (total, [key, item]) => total + (key === id ? 0 : item.blob.size),
      0,
    );
    if (
      (this.artifacts.size >= ARTIFACT_COUNT && !this.artifacts.has(id)) ||
      used + blob.size > ARTIFACT_BYTES
    )
      throw new ApiError(
        "RESOURCE_LIMIT",
        "Artifact storage exceeds 64 artifacts or 1 GiB; delete artifacts before retrying.",
      );
    const info = { artifactId: id, name, mime, bytes: blob.size };
    this.artifacts.set(id, { info, blob, used: Date.now() });
    return info;
  }
  cancelActive() {
    this.active?.controller.abort();
  }
  dispose() {
    this.disposed = true;
    this.ownerDetached = true;
    this.ownerLeased = false;
    this.ownerGeneration++;
    this.ownerEpoch++;
    this.cancelActive();
    try {
      this.releasePreviews();
    } finally {
      this.artifacts.clear();
      this.requests.clear();
    }
  }
  private releasePreviews() {
    const errors: unknown[] = [];
    for (const release of [
      () => releaseInteractiveSession(this.host),
      () => releaseScanPreviewOperation(this.host),
      () => releaseInspectionDisplay(this.host),
      () => releaseGlobalAlignmentPreview(this.host),
      () => disposeReferenceConstructionPreview(this.host),
    ]) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    void releaseDatumPreview(this.host).catch(() => {});
    if (errors.length)
      throw new AggregateError(errors, "Workspace preview cleanup failed.");
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
