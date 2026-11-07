import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CadClient } from "../src/cad/client";
import { coordinateSketchFrame } from "../src/sketch-frame";
class WorkerDouble {
  static instances: WorkerDouble[] = [];
  messages: { id: number; operation: string; payload: unknown }[] = [];
  terminated = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor() {
    WorkerDouble.instances.push(this);
  }
  postMessage(message: { id: number; operation: string; payload: unknown }) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(result: unknown) {
    this.onmessage?.({
      data: { id: this.messages[this.messages.length - 1].id, result },
    });
  }
}
const box = {
  kind: "box" as const,
  center: [0, 0, 0] as [number, number, number],
  size: [1, 1, 1] as [number, number, number],
};
beforeEach(() => {
  vi.useFakeTimers();
  WorkerDouble.instances = [];
  vi.stubGlobal("Worker", WorkerDouble);
  vi.stubGlobal("document", { baseURI: "http://localhost/scanforge/" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("CAD worker ownership and cancellation", () => {
  it("resolves the CAD asset from a processing worker without a document", async () => {
    const urls: string[] = [];
    vi.stubGlobal("document", undefined);
    vi.stubGlobal(
      "Worker",
      class extends WorkerDouble {
        constructor(url: URL) {
          super();
          urls.push(url.href);
        }
      },
    );
    for (const href of [
      "https://example.test/scanforge/assets/processing-worker-abc.js",
      "https://example.test/scanforge/src/processing-worker.ts?worker_file&type=module",
    ]) {
      vi.stubGlobal("self", { location: { href } });
      const client = new CadClient();
      const pending = client.primitive(box).catch((error) => error);
      await vi.advanceTimersByTimeAsync(0);
      expect(urls.at(-1)).toBe("https://example.test/scanforge/cad-worker.js");
      WorkerDouble.instances
        .at(-1)!
        .reply({ kernelId: "worker-cad", positions: [] });
      expect(await pending).toEqual({ kernelId: "worker-cad", positions: [] });
      client.dispose();
    }
  });
  it("routes import progress without completing the request or clearing its timeout", async () => {
    const client = new CadClient();
    const progress = vi.fn();
    const pending = client.importFile(new Uint8Array([1, 2]), "step", progress);
    await vi.advanceTimersByTimeAsync(0);
    const worker = WorkerDouble.instances[0];
    const id = worker.messages[0].id;
    for (const value of [0, 0.35, 0.85, 1])
      worker.onmessage?.({ data: { id, progress: value } });
    worker.onmessage?.({ data: { id: id + 100, progress: 0.5 } });
    worker.onmessage?.({ data: { id, progress: NaN } });
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      0, 0.35, 0.85, 1,
    ]);
    expect(vi.getTimerCount()).toBe(1);
    const result = {
      kernelId: "exact",
      positions: [0, 0, 0],
      edgePositions: [0, 0, 0, 1, 0, 0],
      brep: "BRep",
    };
    worker.reply(result);
    expect(await pending).toEqual(result);
    expect(vi.getTimerCount()).toBe(0);
    worker.onmessage?.({ data: { id, progress: 0.9 } });
    expect(progress).toHaveBeenCalledTimes(4);
    client.dispose();
  });
  it("sends advanced CAD operation contracts without substituting display meshes", async () => {
    const client = new CadClient();
    const points: [number, number][] = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ];
    const cases: [() => Promise<unknown>, string, unknown][] = [
      [
        () =>
          client.transformDatum(
            "exact-cad",
            [1, 0, 0, -5, 0, 1, 0, -6, 0, 0, 1, -7],
          ),
        "datumTransform",
        {
          kernelId: "exact-cad",
          origin: [5, 6, 7],
          xDirection: [1, 0, 0],
          zDirection: [0, 0, 1],
        },
      ],
      [
        () => client.alignmentReferences("exact-cad"),
        "alignmentReferences",
        { kernelId: "exact-cad" },
      ],
      [
        () => client.extrude(points, 10, coordinateSketchFrame("OYZ", 7)),
        "extrude",
        { points, height: 10, frame: coordinateSketchFrame("OYZ", 7) },
      ],
      [
        () =>
          client.loft(
            [
              { points, z: 0 },
              { points, z: 10 },
            ],
            true,
          ),
        "loft",
        {
          profiles: [
            { points, z: 0 },
            { points, z: 10 },
          ],
          ruled: true,
        },
      ],
      [
        () =>
          client.sweep(points, [
            [0, 0, 0],
            [0, 0, 10],
          ]),
        "sweep",
        {
          points,
          path: [
            [0, 0, 0],
            [0, 0, 10],
          ],
        },
      ],
      [
        () => client.edgeTreatment("shape", [0, 2], 1, "fillet"),
        "edges",
        {
          kernelId: "shape",
          edgeIndices: [0, 2],
          amount: 1,
          operation: "fillet",
        },
      ],
      [
        () => client.offset("shape", 2),
        "offset",
        { kernelId: "shape", distance: 2 },
      ],
      [
        () => client.sew(["shape"], 0.01),
        "sew",
        { kernelIds: ["shape"], tolerance: 0.01 },
      ],
    ];
    for (const [run, operation, payload] of cases) {
      const pending = run();
      await vi.advanceTimersByTimeAsync(0);
      const worker = WorkerDouble.instances[0];
      expect(worker.messages.at(-1)).toMatchObject({ operation, payload });
      worker.reply({ kernelId: "result", positions: [0, 0, 0], brep: "exact" });
      await pending;
    }
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("serializes native requests and releases native handles through the protocol", async () => {
    const client = new CadClient();
    const first = client.primitive(box);
    const second = client.primitive(box);
    await vi.advanceTimersByTimeAsync(0);
    const worker = WorkerDouble.instances[0];
    expect(worker.messages).toHaveLength(1);
    worker.reply({ kernelId: "first", positions: [0, 0, 0], brep: "exact" });
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.messages).toHaveLength(2);
    worker.reply({ kernelId: "second", positions: [0, 0, 0] });
    await second;
    const release = client.release(["first"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.messages[2]).toMatchObject({
      operation: "release",
      payload: ["first"],
    });
    worker.reply(true);
    await release;
    client.dispose();
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("sends radius/Z revolve profiles and cone parameters through the worker contract", async () => {
    const client = new CadClient();
    const points: [number, number][] = [
      [10, 0],
      [20, 0],
      [20, 15],
      [10, 15],
    ];
    const revolve = client.revolve(points, 180);
    await vi.advanceTimersByTimeAsync(0);
    const worker = WorkerDouble.instances[0];
    expect(worker.messages[0]).toMatchObject({
      operation: "revolve",
      payload: { points, angleDegrees: 180 },
    });
    worker.reply({ kernelId: "revolved", positions: [0, 0, 0], brep: "exact" });
    await expect(revolve).resolves.toMatchObject({ kernelId: "revolved" });
    const input = {
      kind: "cone" as const,
      center: [0, 0, 0] as [number, number, number],
      axis: [0, 0, 1] as [number, number, number],
      radius: 4,
      topRadius: 2,
      height: 9,
    };
    const cone = client.primitive(input);
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.messages[1]).toMatchObject({
      operation: "primitive",
      payload: input,
    });
    worker.reply({ kernelId: "cone", positions: [0, 0, 0], brep: "exact" });
    await expect(cone).resolves.toMatchObject({ kernelId: "cone" });
    client.dispose();
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("terminates a timed-out worker and rejects active and queued operations", async () => {
    const client = new CadClient();
    const first = client.primitive(box);
    const second = client.primitive(box);
    const firstCheck = expect(first).rejects.toThrow("90 seconds");
    const secondCheck = expect(second).rejects.toThrow("cancelled");
    await vi.advanceTimersByTimeAsync(90_000);
    await firstCheck;
    await secondCheck;
    expect(WorkerDouble.instances).toHaveLength(1);
    expect(WorkerDouble.instances[0].terminated).toBe(true);
    expect(WorkerDouble.instances[0].messages).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    client.dispose();
  });
  it("dispose rejects pending requests and prevents later worker creation", async () => {
    const client = new CadClient();
    const pending = client.primitive(box);
    const check = expect(pending).rejects.toThrow("disposed");
    await vi.advanceTimersByTimeAsync(0);
    client.dispose();
    await check;
    await expect(client.primitive(box)).rejects.toThrow("disposed");
    expect(WorkerDouble.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("owns a private Curvature surface and evaluates its original UV coordinates", async () => {
  const client = new CadClient();
  const patch = { format: "scanforge-nurbs", version: 1 } as never;
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  const pending = client.curvatureSurface(patch, matrix);
  await vi.advanceTimersByTimeAsync(0);
  const worker = WorkerDouble.instances[0];
  expect(worker.messages[0]).toMatchObject({
    operation: "curvatureSurface",
    payload: { patch, matrix },
  });
  const mesh = {
    kernelId: "private-cap",
    vertices: new Float32Array(9),
    triangles: new Uint32Array([0, 1, 2]),
    uvs: new Float64Array(9),
  };
  worker.reply(mesh);
  expect(await pending).toBe(mesh);
  const uvs = new Float64Array([0.25, 0.75, 0]);
  const evaluated = client.curvatureEvaluate("private-cap", uvs);
  await vi.advanceTimersByTimeAsync(0);
  expect(worker.messages.at(-1)).toMatchObject({
    operation: "curvatureEvaluate",
    payload: { kernelId: "private-cap", uvs },
  });
  worker.reply(new Float32Array([1, 2, 3]));
  expect(await evaluated).toEqual(new Float32Array([1, 2, 3]));
  client.dispose();
  expect(worker.terminated).toBe(true);
});
