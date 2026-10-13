import * as THREE from "three";
import type { Positions } from "./types";
import type { ScreenRegion, SelectionView } from "./screen-selection";

/** Owns a reusable worker; geometry/BVH/visibility tests never run on the UI thread. */
export class AsyncScreenSelectionIndex {
  private workers: Worker[] = [];
  private pending?: {
    resolve: (mask: Uint8Array) => void;
    reject: (error: Error) => void;
    mask: Uint8Array;
    remaining: number;
  };
  private lease?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(
    private positions: Positions,
    private hidden: number[] = [],
    private pointCloud = false,
  ) {}
  /** Start the owned BVH while the user chooses a tool or draws the first loop. */
  prepare(): void {
    if (this.disposed || this.pending) return;
    this.ensureWorker();
    clearTimeout(this.lease);
    this.lease = setTimeout(() => this.stop(), 60_000);
  }
  private ensureWorker(): Worker {
    if (!this.workers.length) {
      const count = this.pointCloud
        ? 1
        : selectionWorkerCount(
            this.positions.length / (this.pointCloud ? 3 : 9),
          );
      for (let part = 0; part < count; part++) {
        const worker = new Worker(
          new URL("./screen-selection-worker.ts", import.meta.url),
          { type: "module" },
        );
        this.workers.push(worker);
        worker.onmessage = ({ data }) => {
          if (!this.workers.includes(worker) || !this.pending) return;
          if (data.error) {
            this.pending.reject(new Error(data.error));
            this.pending = undefined;
            this.stop();
            return;
          }
          const pending = this.pending;
          pending.mask.set(data.mask, data.start ?? 0);
          if (--pending.remaining) return;
          this.pending = undefined;
          clearTimeout(this.lease);
          pending.resolve(pending.mask);
          this.lease = setTimeout(() => this.stop(), 60_000);
        };
        worker.onerror = (event) => {
          if (!this.workers.includes(worker)) return;
          this.pending?.reject(
            new Error(event.message || "Selection worker failed."),
          );
          this.pending = undefined;
          this.stop();
        };
        worker.onmessageerror = () => {
          if (!this.workers.includes(worker)) return;
          this.pending?.reject(
            new Error("Selection result could not be decoded."),
          );
          this.pending = undefined;
          this.stop();
        };
        // Each shard needs the entire mesh for correct cross-shard occlusion.
        const positions = Float32Array.from(this.positions);
        worker.postMessage(
          {
            initialize: {
              positions,
              hidden: this.hidden,
              pointCloud: this.pointCloud,
            },
          },
          [positions.buffer],
        );
      }
    }
    return this.workers[0];
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
    this.ensureWorker();
    camera.updateMatrixWorld();
    const frame = {
      orthographic: camera instanceof THREE.OrthographicCamera,
      matrix: camera.matrixWorld.toArray(),
      projection: camera.projectionMatrix.toArray(),
      near: (camera as THREE.PerspectiveCamera).near,
      far: (camera as THREE.PerspectiveCamera).far,
    };
    return new Promise((resolve, reject) => {
      this.pending = {
        resolve,
        reject,
        mask: new Uint8Array(this.positions.length / (this.pointCloud ? 3 : 9)),
        remaining: this.workers.length,
      };
      this.lease = setTimeout(() => {
        this.pending?.reject(
          new Error("Selection timed out. Try a smaller region."),
        );
        this.pending = undefined;
        this.stop();
      }, 120_000);
      try {
        this.workers.forEach((worker, part) => {
          const start = Math.floor(
            (part * this.pending!.mask.length) / this.workers.length,
          );
          const end = Math.floor(
            ((part + 1) * this.pending!.mask.length) / this.workers.length,
          );
          worker.postMessage({ frame, region, view, range: { start, end } });
        });
      } catch (error) {
        this.pending = undefined;
        this.stop();
        reject(error);
      }
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
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
  }
  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.stop();
  }
}

/** Keep small queries single-core and bound duplicated geometry/BVH memory. */
export function selectionWorkerCount(triangles: number): number {
  const hardware = globalThis.navigator?.hardwareConcurrency ?? 2;
  const memory = (
    globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined
  )?.deviceMemory;
  if (
    triangles < 100_000 ||
    hardware < 4 ||
    (memory !== undefined && memory < 8)
  )
    return 1;
  // Conservative 4x position-buffer estimate for geometry, BVH and scratch per worker.
  const budget = 128 * 1024 * 1024;
  return Math.max(
    1,
    Math.min(2, hardware - 1, Math.floor(budget / (triangles * 36 * 4))),
  );
}
