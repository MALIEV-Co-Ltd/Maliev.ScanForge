import type { Positions } from "./types";
import type { ScanEditRequest, ScanEditResult } from "./scan-edit";

export type BridgeOperation = Omit<ScanEditRequest, "kind" | "positions">;
interface PreviewCallbacks {
  display(patch?: Float32Array): void;
  commit(positions: Float32Array, label: string): void;
  status(message: string): void;
  error(message: string): void;
}

/** Owns one cancellable bridge preview; a release accepts that exact result once. */
export class BridgePreviewController {
  private active?: {
    key: string;
    controller: AbortController;
    accept: boolean;
    result?: ScanEditResult;
  };
  private disposed = false;
  constructor(
    private readonly source: Positions,
    private readonly generate: (
      operation: BridgeOperation,
      signal: AbortSignal,
    ) => Promise<ScanEditResult>,
    private readonly callbacks: PreviewCallbacks,
  ) {}
  request(operation: BridgeOperation | null, accept: boolean): void {
    if (this.disposed) return;
    if (!operation) {
      this.cancel();
      return;
    }
    const key = JSON.stringify(operation);
    if (this.active?.key === key) {
      this.active.accept ||= accept;
      if (this.active.result && accept) this.finish(this.active);
      return;
    }
    this.cancel();
    const active = {
      key,
      controller: new AbortController(),
      accept,
    } as NonNullable<typeof this.active>;
    this.active = active;
    this.callbacks.status("Calculating bridge preview…");
    void this.generate(operation, active.controller.signal)
      .then((result) => {
        if (
          this.active !== active ||
          active.controller.signal.aborted ||
          this.disposed
        )
          return;
        if (
          !(result.positions instanceof Float32Array) ||
          result.diagnostics.filledHoles !== 1 ||
          result.positions.length <= this.source.length
        )
          throw new Error(
            "These edges cannot form a valid bridge. Choose two separate edges across the opening.",
          );
        active.result = result;
        this.callbacks.display(result.positions.slice(this.source.length));
        this.callbacks.status(
          `Bridge preview · ${result.diagnostics.method} · ${result.diagnostics.addedTriangles} triangles`,
        );
        if (active.accept) this.finish(active);
      })
      .catch((error) => {
        if (
          this.active !== active ||
          active.controller.signal.aborted ||
          this.disposed
        )
          return;
        this.active = undefined;
        this.callbacks.display();
        const message = error instanceof Error ? error.message : String(error);
        if (active.accept) this.callbacks.error(message);
        else this.callbacks.status(message);
      });
  }
  private finish(active: NonNullable<typeof this.active>): void {
    if (
      this.active !== active ||
      !(active.result?.positions instanceof Float32Array)
    )
      return;
    this.active = undefined;
    this.callbacks.display();
    this.callbacks.commit(active.result.positions, "Bridge mesh edges");
    this.callbacks.status(
      `Bridge created · ${active.result.diagnostics.method}. Drag another bridge or use Undo.`,
    );
  }
  cancel(): void {
    this.active?.controller.abort();
    this.active = undefined;
    this.callbacks.display();
    this.callbacks.status("");
  }
  dispose(): void {
    this.cancel();
    this.disposed = true;
  }
}
