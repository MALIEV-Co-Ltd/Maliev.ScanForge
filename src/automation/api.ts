import catalog from "./catalog.json";
import { cloudPlacement } from "../point-cloud-placement";
import { releaseDatumPreview } from "./datum-preview-resources";
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
  previewLandmarks?(options: LandmarkPreviewOptions): Promise<unknown>;
  acceptLandmarks?(): unknown;
  inspectLandmarks?(): unknown;
  editLandmarks?(
    edit:
      | LandmarkEdit
      | {
          action: "begin";
          movingId: string;
          fixedId: string;
          targetScope?: LandmarkTargetScope;
        },
  ): unknown;
  inspectCommands?(): unknown;
  launchCommand?(name?: string): unknown;
  snapshot(): WorkspaceSnapshot;
  cad(): CadClient;
  commit(entities: Entity[], label: string): void;
  replace(
    project: Project,
    cad?: CadClient,
    session?: { history: Revision[]; future: Revision[]; projectId?: string },
  ): void;
  select(id: string | null, modifiers?: ObjectSelectionModifiers): void;
  present?(signal?: AbortSignal): Promise<void>;
  showDatumPreview?(entities: Entity[] | null): void;
  setSelection(entityId: string, mask: Uint8Array): void;
  setSketch(sketch: Sketch): void;
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
  inspectViewport?(): unknown;
  controlViewport?(command: ViewportCommand): void;
  pickViewport?(x: number, y: number, maxHits: number): unknown;
  captureScreenshot?(
    options: VisualCaptureOptions,
    signal: AbortSignal,
  ): Promise<CapturedImage>;
  renameProject?(name: string): void;
  discardPreview?(
    target: "scan" | "surface" | "landmarks" | "sketchSection" | "datum",
  ): void;
}
export interface ArtifactInfo {
  artifactId: string;
  name: string;
  mime: string;
  bytes: number;
}
export interface CommandContext {
  signal: AbortSignal;
  progress(fraction: number, stage: string): void;
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
class ApiError extends Error {
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
  constructor(
    private host: WorkspaceHost,
    private handlers: Record<string, Handler>,
  ) {}

  currentRevision() {
    const next = this.host.snapshot();
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
        e.color,
        e.opacity,
        e.visible,
        e.locked,
        e.selectable,
        e.kernelId,
        identity(cloudPlacement(e)?.sourcePositions ?? e.positions),
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
        identity(s.sketch),
      ]),
      activeSketchId: next.authoring.activeSketchId,
      settings: next.settings,
    });
    if (this.stateKey !== undefined && key !== this.stateKey) this.revision++;
    this.stateKey = key;
    return this.revision;
  }

  async invoke(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<ApiResult> {
    try {
      if (this.disposed)
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
      let startRevision = this.currentRevision();
      if (!readOnly && args.expectedRevision !== startRevision)
        throw new ApiError(
          "REVISION_CONFLICT",
          "Workspace changed; inspect project_get and use its current revision with a new requestId.",
        );
      if (command === "preview_discard") {
        if (!this.host.discardPreview)
          throw new ApiError(
            "UNSUPPORTED",
            "GUI preview cancellation is unavailable.",
          );
        this.host.discardPreview(
          args.target as
            "scan" | "surface" | "landmarks" | "sketchSection" | "datum",
        );
        if (
          args.target === "landmarks" &&
          this.active?.command === "landmark_preview"
        )
          this.active.controller.abort();
        if (args.target === "datum") await releaseDatumPreview(this.host);
        return this.success({
          target: args.target,
          cancellationRequested: true,
          committedGeometryPreserved: true,
          note:
            args.target === "landmarks"
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
            expiresAt: new Date(used + 900000).toISOString(),
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
            artifactBytes: 64 * 1024 * 1024,
            artifactLeaseSeconds: 900,
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
        if (data.byteLength > 1048576)
          throw new ApiError(
            "RESOURCE_LIMIT",
            "Upload chunks cannot exceed 1 MiB decoded.",
          );
        let blob = new Blob([data]);
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
        } else if (args.offset !== 0)
          throw new ApiError(
            "UPLOAD_CONFLICT",
            "First chunk offset must be zero.",
          );
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
        let text = "";
        for (const byte of data) text += String.fromCharCode(byte);
        return this.success({
          ...entry.info,
          offset,
          base64: btoa(text),
          nextOffset: offset + data.length,
          eof: offset + data.length === entry.blob.size,
        });
      }
      if (command === "artifact_delete") {
        this.artifacts.delete(args.artifactId as string);
        return this.success({ deleted: true });
      }
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
      const context: CommandContext = {
        signal: job.controller.signal,
        progress: (fraction, stage) => {
          job.progress = Math.max(0, Math.min(1, fraction));
          job.stage = stage;
        },
        check: () => {
          job.controller.signal.throwIfAborted();
          if (this.disposed)
            throw new ApiError("DISCONNECTED", "Workspace closed.");
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
        artifact: (data, name, mime) => this.storeArtifact(data, name, mime),
        artifactBlob: (id) => {
          const entry = this.getArtifact(id);
          return new File([entry.blob], entry.info.name, {
            type: entry.info.mime,
          });
        },
      };
      if (readOnly && !asynchronous)
        return this.success(await handler(args, context));
      if (this.active || this.host.busy())
        throw new ApiError(
          "BUSY",
          "Workspace is executing an operation; wait for completion or cancel the active job.",
        );
      // Launchers delegate progress and busy ownership to the normal GUI/domain
      // command. Setting API activity here would block that command itself.
      if (command === "command_run" || command === "command_repeat")
        return this.success(await handler(args, context));
      // A single admission lane also protects native read operations from concurrent edits.
      this.active = job;
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
          job.status = job.controller.signal.aborted ? "cancelled" : "failed";
          const failure = this.failure(error);
          job.error = failure.error;
          job.stage = failure.error.message;
          return failure;
        } finally {
          clearTimeout(job.timer);
          this.active = undefined;
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
      if (Date.now() - item.used > 900000) this.artifacts.delete(id);
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
      (this.artifacts.size >= 64 && !this.artifacts.has(id)) ||
      used + blob.size > 64 * 1024 * 1024
    )
      throw new ApiError(
        "RESOURCE_LIMIT",
        "Artifact storage exceeds 64 artifacts or 64 MiB; delete artifacts before retrying.",
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
    this.cancelActive();
    void releaseDatumPreview(this.host).catch(() => {});
    this.artifacts.clear();
    this.requests.clear();
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
