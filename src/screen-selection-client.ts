import * as THREE from "three";
import type { Positions } from "./types";
import type { ScreenRegion, SelectionView } from "./screen-selection";

/** Owns a reusable worker; geometry/BVH/visibility tests never run on the UI thread. */
export class AsyncScreenSelectionIndex {
  private worker?: Worker;
  private pending?: {
    resolve: (mask: Uint8Array) => void;
    reject: (error: Error) => void;
  };
  private lease?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(
    private positions: Positions,
    private hidden: number[] = [],
  ) {}
  /** Start the owned BVH while the user chooses a tool or draws the first loop. */
  prepare(): void {
    if (this.disposed || this.pending) return;
    this.ensureWorker();
    clearTimeout(this.lease);
    this.lease = setTimeout(() => this.stop(), 60_000);
  }
  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL("./screen-selection-worker.ts", import.meta.url),
        { type: "module" },
      );
      const worker = this.worker;
      worker.onmessage = ({ data }) => {
        if (this.worker !== worker) return;
        const pending = this.pending;
        this.pending = undefined;
        clearTimeout(this.lease);
        if (data.error) {
          pending?.reject(new Error(data.error));
          this.stop();
          return;
        }
        pending?.resolve(data.mask);
        this.lease = setTimeout(() => this.stop(), 60_000);
      };
      worker.onerror = (event) => {
        if (this.worker !== worker) return;
        this.pending?.reject(
          new Error(event.message || "Selection worker failed."),
        );
        this.pending = undefined;
        this.stop();
      };
      const positions = Float32Array.from(this.positions);
      this.worker.postMessage(
        { initialize: { positions, hidden: this.hidden } },
        [positions.buffer],
      );
    }
    return this.worker;
  }
  select(
    camera: THREE.Camera,
    region: ScreenRegion,
    view: SelectionView,
  ): Promise<Uint8Array> {
    if (this.disposed)
      return Promise.reject(new Error("Selection index is closed."));
    if (this.pending) this.cancel();
    clearTimeout(this.lease);
    const worker = this.ensureWorker();
    camera.updateMatrixWorld();
    const frame = {
      orthographic: camera instanceof THREE.OrthographicCamera,
      matrix: camera.matrixWorld.toArray(),
      projection: camera.projectionMatrix.toArray(),
      near: (camera as THREE.PerspectiveCamera).near,
      far: (camera as THREE.PerspectiveCamera).far,
    };
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.lease = setTimeout(() => {
        this.pending?.reject(
          new Error("Selection timed out. Try a smaller region."),
        );
        this.pending = undefined;
        this.stop();
      }, 120_000);
      worker.postMessage({ frame, region, view });
    });
  }
  cancel(): void {
    // A new gesture cancels an in-flight query, not the reusable idle BVH.
    if (!this.pending) return;
    this.pending?.reject(
      new DOMException("Selection superseded", "AbortError"),
    );
    this.pending = undefined;
    this.stop();
  }
  private stop(): void {
    clearTimeout(this.lease);
    this.worker?.terminate();
    this.worker = undefined;
  }
  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.stop();
  }
}
