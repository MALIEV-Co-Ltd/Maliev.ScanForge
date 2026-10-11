import type { KernelMesh, KernelPrimitive, Vec3 } from "../types";

type Result = KernelMesh | Uint8Array | boolean;
type Reply = { id: number; result?: Result; error?: string };

/** Owns one isolated browser-local CAD worker. Reset invalidates all kernel IDs. */
export class CadClient {
  private worker?: Worker;
  private nextId = 0;
  private disposed = false;
  private pending = new Map<
    number,
    {
      resolve: (result: Result) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;

  importFile(
    data: Uint8Array,
    extension: "step" | "stp" | "iges" | "igs" | "brep",
  ): Promise<KernelMesh> {
    return this.request("import", {
      data: data.slice(),
      extension,
    }) as Promise<KernelMesh>;
  }

  primitive(input: KernelPrimitive): Promise<KernelMesh> {
    return this.request("primitive", input) as Promise<KernelMesh>;
  }

  exportStep(kernelIds: string[]): Promise<Uint8Array> {
    return this.request("export", [...kernelIds]) as Promise<Uint8Array>;
  }

  boolean(
    operation: "union" | "subtract" | "intersect",
    firstId: string,
    secondId: string,
  ): Promise<KernelMesh> {
    return this.request("boolean", {
      operation,
      firstId,
      secondId,
    }) as Promise<KernelMesh>;
  }

  transform(
    kernelId: string,
    translation: Vec3,
    rotation: Vec3,
    scale: number,
  ): Promise<KernelMesh> {
    return this.request("transform", {
      kernelId,
      translation,
      rotation,
      scale,
    }) as Promise<KernelMesh>;
  }

  extrude(points: [number, number][], height: number): Promise<KernelMesh> {
    return this.request("extrude", { points, height }) as Promise<KernelMesh>;
  }

  /** Revolve a closed radius/Z meridian polygon about the world Z axis. */
  revolve(
    points: [number, number][],
    angleDegrees: number,
  ): Promise<KernelMesh> {
    return this.request("revolve", {
      points,
      angleDegrees,
    }) as Promise<KernelMesh>;
  }

  /** Release deleted entities' native CAD shapes while preserving other handles. */
  async release(kernelIds: string[]): Promise<void> {
    await this.request("release", [...kernelIds]);
  }

  reset(): void {
    this.stop(
      new Error(
        "CAD kernel reset; previous CAD handles are no longer available.",
      ),
    );
  }

  dispose(): void {
    this.disposed = true;
    this.stop(new Error("CAD client disposed."));
  }

  private stop(error: Error): void {
    this.generation++;
    this.worker?.terminate();
    this.worker = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.queue = Promise.resolve();
  }

  private getWorker(): Worker {
    if (this.disposed) throw new Error("CAD client disposed.");
    if (!this.worker) {
      const base = new URL(import.meta.env.BASE_URL, document.baseURI);
      this.worker = new Worker(new URL("cad-worker.js", base), {
        name: "scanforge-cad",
      });
      this.worker.onmessage = (event: MessageEvent<Reply>) => {
        const request = this.pending.get(event.data.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.pending.delete(event.data.id);
        if (event.data.error) request.reject(new Error(event.data.error));
        else if (event.data.result !== undefined)
          request.resolve(event.data.result);
        else request.reject(new Error("CAD worker returned an empty result."));
      };
      this.worker.onerror = () =>
        this.stop(
          new Error(
            "CAD worker failed. Check that local kernel assets are installed.",
          ),
        );
      this.worker.onmessageerror = () =>
        this.stop(new Error("CAD worker message could not be decoded."));
    }
    return this.worker;
  }

  private request(operation: string, payload: unknown): Promise<Result> {
    const generation = this.generation;
    const task = this.queue.then(() => {
      if (generation !== this.generation)
        throw new Error("CAD request cancelled by reset.");
      const worker = this.getWorker();
      return new Promise<Result>((resolve, reject) => {
        const id = ++this.nextId;
        const timer = setTimeout(
          () =>
            this.stop(
              new Error("CAD operation exceeded 90 seconds; kernel reset."),
            ),
          90_000,
        );
        this.pending.set(id, { resolve, reject, timer });
        try {
          const data =
            operation === "import"
              ? (payload as { data: Uint8Array }).data
              : undefined;
          worker.postMessage(
            { id, operation, payload },
            data ? [data.buffer as ArrayBuffer] : [],
          );
        } catch (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(
            error instanceof Error
              ? error
              : new Error("CAD request could not be sent."),
          );
        }
      });
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}
