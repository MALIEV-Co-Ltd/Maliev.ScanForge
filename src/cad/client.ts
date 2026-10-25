import type { SketchProfileEdge } from "../sketch";
import type { IndexedMesh, KernelMesh, KernelPrimitive, Vec3 } from "../types";
import type { NurbsPatch } from "../surfaces";
import { validateSketchFrame, type SketchFrame } from "../sketch-frame";
import type { CadAlignmentInput } from "./alignment-reference";
import { nativeDatumInverseFrame } from "../scan-native-datum-apply";

export type CadPattern =
  | { kind: "linear"; count: number; step: Vec3 }
  | {
      kind: "circular";
      count: number;
      center: Vec3;
      axis: Vec3;
      angleDegrees: number;
    };
type Result =
  | KernelMesh
  | KernelMesh[]
  | Uint8Array
  | boolean
  | CadAlignmentInput[]
  | IndexedMesh;
type Reply = { id: number; result?: Result; error?: string; progress?: number };

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
      onProgress?: (fraction: number) => void;
    }
  >();
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;

  importFile(
    data: Uint8Array,
    extension: "step" | "stp" | "iges" | "igs" | "brep",
    onProgress?: (fraction: number) => void,
  ): Promise<KernelMesh> {
    return this.request(
      "import",
      {
        data: data.slice(),
        extension,
      },
      onProgress,
    ) as Promise<KernelMesh>;
  }

  primitive(input: KernelPrimitive): Promise<KernelMesh> {
    return this.request("primitive", input) as Promise<KernelMesh>;
  }

  /** Read exact face inputs for shared alignment conversion; does not mutate the body. */
  alignmentReferences(kernelId: string): Promise<CadAlignmentInput[]> {
    return this.request("alignmentReferences", { kernelId }) as Promise<
      CadAlignmentInput[]
    >;
  }

  /** Acquire the cached exact-face triangulations without changing the BRep. */
  alignmentMesh(kernelId: string): Promise<IndexedMesh> {
    return this.request("alignmentMesh", {
      kernelId,
      includeUVs: false,
    }) as Promise<IndexedMesh>;
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

  transformDatum(
    kernelId: string,
    matrix: readonly number[],
  ): Promise<KernelMesh & { placementMatrix: number[] }> {
    const inverse = nativeDatumInverseFrame(matrix);
    return this.request("datumTransform", {
      kernelId,
      origin: [inverse[3], inverse[7], inverse[11]],
      xDirection: [inverse[0], inverse[4], inverse[8]],
      zDirection: [inverse[2], inverse[6], inverse[10]],
    }) as Promise<KernelMesh & { placementMatrix: number[] }>;
  }

  extrudeCurves(
    edges: SketchProfileEdge[],
    height: number,
    frame?: SketchFrame,
  ): Promise<KernelMesh> {
    if (frame !== undefined) validateSketchFrame(frame);
    return this.request("extrudeCurves", {
      edges,
      height,
      frame,
    }) as Promise<KernelMesh>;
  }

  extrude(
    points: [number, number][],
    height: number,
    frame?: SketchFrame,
  ): Promise<KernelMesh> {
    if (frame !== undefined) validateSketchFrame(frame);
    return this.request("extrude", {
      points,
      height,
      frame,
    }) as Promise<KernelMesh>;
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

  loft(
    profiles: { points: [number, number][]; z: number }[],
    ruled = false,
  ): Promise<KernelMesh> {
    return this.request("loft", { profiles, ruled }) as Promise<KernelMesh>;
  }

  /** Profile coordinates lie in the normal plane of the first spine segment. */
  sweep(points: [number, number][], path: Vec3[]): Promise<KernelMesh> {
    return this.request("sweep", { points, path }) as Promise<KernelMesh>;
  }

  /** Indices identify unique edges in kernel traversal order, starting at zero. */
  edgeTreatment(
    kernelId: string,
    edgeIndices: number[],
    amount: number,
    operation: "fillet" | "chamfer",
  ): Promise<KernelMesh> {
    return this.request("edges", {
      kernelId,
      edgeIndices,
      amount,
      operation,
    }) as Promise<KernelMesh>;
  }

  offset(kernelId: string, distance: number): Promise<KernelMesh> {
    return this.request("offset", {
      kernelId,
      distance,
    }) as Promise<KernelMesh>;
  }

  sew(kernelIds: string[], tolerance = 1e-6): Promise<KernelMesh> {
    return this.request("sew", { kernelIds, tolerance }) as Promise<KernelMesh>;
  }

  /** Construct an exact rational tensor B-spline CAD face from its control net. */
  surface(patch: NurbsPatch): Promise<KernelMesh> {
    return this.request("surface", patch) as Promise<KernelMesh>;
  }

  /** Sew compatible patches into one finite, validated closed CAD solid. */
  closedShell(patches: NurbsPatch[], tolerance = 1e-6): Promise<KernelMesh> {
    return this.request("closedShell", {
      patches,
      tolerance,
    }) as Promise<KernelMesh>;
  }

  shell(
    kernelId: string,
    faceIndices: number[],
    thickness: number,
  ): Promise<KernelMesh> {
    return this.request("shell", {
      kernelId,
      faceIndices,
      thickness,
    }) as Promise<KernelMesh>;
  }

  thicken(kernelId: string, thickness: number): Promise<KernelMesh> {
    return this.request("thicken", {
      kernelId,
      thickness,
    }) as Promise<KernelMesh>;
  }

  /** Count includes the original; patterns produce an unfused exact compound. */
  pattern(kernelId: string, pattern: CadPattern): Promise<KernelMesh> {
    return this.request("pattern", {
      kernelId,
      ...pattern,
    }) as Promise<KernelMesh>;
  }

  mirror(
    kernelId: string,
    planeOrigin: Vec3,
    normal: Vec3,
  ): Promise<KernelMesh> {
    return this.request("mirror", {
      kernelId,
      planeOrigin,
      normal,
    }) as Promise<KernelMesh>;
  }

  /** Returns cutter-inside and cutter-outside solids, with atomic native registration. */
  split(kernelId: string, cutterId: string): Promise<[KernelMesh, KernelMesh]> {
    return this.request("split", { kernelId, cutterId }) as Promise<
      [KernelMesh, KernelMesh]
    >;
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
        if (event.data.progress !== undefined) {
          if (
            Number.isFinite(event.data.progress) &&
            event.data.progress >= 0 &&
            event.data.progress <= 1
          )
            request.onProgress?.(event.data.progress);
          return;
        }
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

  private request(
    operation: string,
    payload: unknown,
    onProgress?: (fraction: number) => void,
  ): Promise<Result> {
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
        this.pending.set(id, { resolve, reject, timer, onProgress });
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
