import type { InteractiveBoundsSource } from "./interactive-bounds-pool";
import type { InteractiveMirrorSettings } from "./interactive-bounds-worker";
import type { InteractiveMirrorBackend } from "./interactive-mirror-backend";
import { nativeInteractiveMirrorPoints } from "./interactive-mirror-selection";
import {
  nativeInteractiveMirrorModelMatrix,
  nativeInteractiveMirrorPlane,
} from "./interactive-mirror-view";
import type { InteractiveDisplayPose } from "./viewport-interactive-preview";

export interface InteractiveMirrorRequest {
  poses: readonly InteractiveDisplayPose[];
  plane: number;
  settings: InteractiveMirrorSettings;
}
export interface InteractiveMirrorSink {
  show(poses: readonly InteractiveDisplayPose[], plane: number): void;
  publish(
    entityId: string,
    prepared: { indices: Uint32Array; colors?: Float32Array },
  ): void;
  prepare(): Promise<boolean>;
  dispose(): void;
}
interface Request extends InteractiveMirrorRequest {
  key: string;
  colorKey: string;
  epoch: number;
}
/** One viewport consumer borrows one session backend. Camera changes replace pending work; poses stay on the GPU. */
export class InteractiveMirrorController {
  private readonly sources = new Map<
    string,
    Readonly<InteractiveBoundsSource>
  >();
  private readonly colors = new Map<string, string>();
  private readonly published = new Map<string, string>();
  private sink?: InteractiveMirrorSink;
  private shownPoseKey?: string;
  private wanted?: Request;
  private running?: Promise<void>;
  private completed?: string;
  private failed?: string;
  private error: string | null = null;
  private epoch = 0;
  private disposed = false;
  constructor(
    private readonly backend: InteractiveMirrorBackend,
    private readonly options: {
      create(
        sources: ReadonlyMap<string, Readonly<InteractiveBoundsSource>>,
      ): InteractiveMirrorSink;
      onError?(error: unknown): void;
    },
  ) {}
  update(input: InteractiveMirrorRequest | null): void {
    if (this.disposed && input)
      throw new Error("Interactive mirror controller is closed.");
    if (!input) {
      this.wanted = undefined;
      this.epoch++;
      this.sink?.dispose();
      this.sink = undefined;
      this.shownPoseKey = undefined;
      this.colors.clear();
      this.published.clear();
      this.completed = undefined;
      this.failed = undefined;
      this.error = null;
      return;
    }
    nativeInteractiveMirrorPlane(input.plane);
    const ids = input.poses.map((p) => p.entityId);
    if (
      !ids.length ||
      ids.length > 32 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !this.backend.entityIds.includes(id))
    )
      throw new Error(
        "Interactive mirror requires distinct session mesh targets.",
      );
    for (const pose of input.poses)
      nativeInteractiveMirrorModelMatrix(pose.matrix);
    // Reuse the verified native kernel's constant-size input validation, without scanning any source vertices.
    nativeInteractiveMirrorPoints(
      {
        ...input.settings,
        normals: new Float32Array(),
        flags: new Uint32Array(),
      },
      { indicesOnly: true },
    );
    const settings = {
      ...input.settings,
      direction: input.settings.direction.map(Math.fround),
      baseColor: input.settings.baseColor.map(Math.fround),
      selectedColor: input.settings.selectedColor.map(Math.fround),
    };
    const colorKey = JSON.stringify([
      settings.stride,
      !!settings.onlySelected,
      settings.baseColor,
      settings.selectedColor,
      settings.direction.every((v) => v === 0),
    ]);
    const key = JSON.stringify([
      ids,
      colorKey,
      settings.direction,
      !!settings.backfaces,
      settings.allowanceMilliseconds,
      settings.elapsedMilliseconds,
    ]);
    const next: Request = {
      poses: input.poses.map((p) => ({
        entityId: p.entityId,
        matrix: [...p.matrix],
      })),
      plane: input.plane,
      settings,
      key,
      colorKey,
      epoch: this.epoch,
    };
    // A bad caller cannot replace the current request or partially change its matrices.
    if (this.sink) this.show(next);
    this.wanted = next;
    if (this.failed !== key) this.error = null;
    this.pump();
  }
  private show(request: InteractiveMirrorRequest) {
    const key = JSON.stringify([request.poses, request.plane]);
    if (this.shownPoseKey !== key) {
      this.sink!.show(request.poses, request.plane);
      this.shownPoseKey = key;
    }
  }
  private active(request: Request) {
    return (
      !this.disposed &&
      this.wanted?.key === request.key &&
      this.epoch === request.epoch
    );
  }
  private needsWork() {
    return (
      this.wanted &&
      (this.completed !== this.wanted.key ||
        this.wanted.poses.some(
          (p) => this.published.get(p.entityId) !== this.wanted!.key,
        )) &&
      this.failed !== this.wanted.key
    );
  }
  private pump() {
    if (this.running || !this.needsWork()) return;
    this.running = this.drain().finally(() => {
      this.running = undefined;
      this.pump();
    });
  }
  private async drain() {
    while (this.needsWork()) {
      const request = this.wanted!;
      try {
        for (const pose of request.poses) {
          if (!this.sources.has(pose.entityId)) {
            const source = await this.backend.source(pose.entityId);
            if (!this.disposed) this.sources.set(pose.entityId, source);
          }
          if (!this.active(request)) break;
        }
        if (!this.active(request)) continue;
        if (!this.sink) this.sink = this.options.create(this.sources);
        const sink = this.sink;
        this.show(this.wanted!);
        for (const pose of request.poses) {
          if (this.published.get(pose.entityId) === request.key) continue;
          const includeColors =
            this.colors.get(pose.entityId) !== request.colorKey;
          const points = await this.backend.prepare(
            pose.entityId,
            request.settings,
            includeColors,
          );
          if (!this.active(request) || this.sink !== sink) break;
          sink.publish(pose.entityId, points);
          this.published.set(pose.entityId, request.key);
          if (includeColors) this.colors.set(pose.entityId, request.colorKey);
        }
        if (!this.active(request) || this.sink !== sink) continue;
        this.show(this.wanted!);
        const ready = await sink.prepare();
        if (!this.active(request) || this.sink !== sink) continue;
        if (!ready)
          throw new Error(
            "Interactive mirror GPU preparation was interrupted.",
          );
        this.completed = request.key;
        this.failed = undefined;
        this.error = null;
      } catch (error) {
        if (!this.active(request)) continue;
        this.failed = request.key;
        this.error = error instanceof Error ? error.message : String(error);
        try {
          this.options.onError?.(error);
        } catch {
          /* Diagnostics retain the original preparation failure. */
        }
      }
    }
  }
  async settled() {
    while (this.running) await this.running;
  }
  retry() {
    if (this.disposed)
      throw new Error("Interactive mirror controller is closed.");
    this.failed = undefined;
    this.error = null;
    this.pump();
  }
  inspect() {
    return {
      active: !!this.wanted,
      pending: !!this.needsWork(),
      ready:
        !!this.wanted &&
        this.completed === this.wanted.key &&
        !this.error &&
        this.wanted.poses.every(
          (p) => this.published.get(p.entityId) === this.wanted!.key,
        ),
      error: this.error,
      sourceCount: this.sources.size,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.update(null);
    this.disposed = true;
    this.sources.clear();
  }
}
