import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BufferAttribute, BufferGeometry, Mesh } from "three";
import { prepareViewportPicking } from "../src/viewport-picking";
import {
  backgroundMeshPreparation,
  prepareMeshInBackground,
  stopBackgroundMeshPreparation,
} from "../src/scan-background-preparation";
import { observeScanDiagnostics } from "../src/scan-diagnostics";
import { processMesh } from "../src/processing-client";
import { releaseProcessingSession } from "../src/processing-session";

class PreparationWorker {
  static instances: PreparationWorker[] = [];
  static failPicking = false;
  onmessage: ((event: { data: any }) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  terminated = false;
  request: any;
  constructor(readonly url: URL) {
    if (
      PreparationWorker.failPicking &&
      String(url).includes("viewport-picking")
    )
      throw new Error("Picking worker unavailable");
    PreparationWorker.instances.push(this);
  }
  postMessage(request: unknown) {
    this.request = request;
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data });
  }
}

let meshes: Mesh[] = [];
const latest = (kind: string) =>
  PreparationWorker.instances
    .filter((worker) => String(worker.url).includes(kind))
    .at(-1)!;
function mesh() {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(30_000 * 3), 3),
  );
  const result = new Mesh(geometry);
  meshes.push(result);
  return result;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", PreparationWorker);
  PreparationWorker.instances = [];
  PreparationWorker.failPicking = false;
});
afterEach(async () => {
  for (const item of meshes) {
    item.geometry.dispose();
    if (!Array.isArray(item.material)) item.material.dispose();
  }
  meshes = [];
  stopBackgroundMeshPreparation();
  await Promise.resolve();
  await Promise.resolve();
  releaseProcessingSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("defers speculative topology until active and queued picking jobs both finish", async () => {
  const source = new Float32Array(9);
  prepareMeshInBackground(source);
  const a = mesh(),
    b = mesh();
  const first = prepareViewportPicking(a);
  expect(prepareViewportPicking(a)).toBe(first);
  const firstWorker = latest("viewport-picking");
  const second = prepareViewportPicking(b);
  await vi.advanceTimersByTimeAsync(500);
  const activePhase = backgroundMeshPreparation(source).phase;
  firstWorker.reply({ failed: true });
  await first;
  const secondWorker = latest("viewport-picking");
  await vi.advanceTimersByTimeAsync(500);
  const queuedPhase = backgroundMeshPreparation(source).phase;
  secondWorker.reply({ failed: true });
  await second;
  await vi.advanceTimersByTimeAsync(500);
  expect(activePhase).toBe("scheduled");
  expect(queuedPhase).toBe("scheduled");
  expect(secondWorker).not.toBe(firstWorker);
  expect(backgroundMeshPreparation(source).phase).toBe("pending");
  expect(latest("processing-worker").request.kind).toBe("report");
});

it.each(["message", "error", "dispose", "timeout", "constructor"] as const)(
  "yields active speculation before picking and resumes it after %s",
  async (outcome) => {
    const source = new Float32Array(9);
    prepareMeshInBackground(source);
    await vi.advanceTimersByTimeAsync(500);
    const background = latest("processing-worker");
    PreparationWorker.failPicking = outcome === "constructor";
    const item = mesh();
    const ready = prepareViewportPicking(item);
    const yielded = background.terminated;
    const phase = backgroundMeshPreparation(source).phase;
    const picking = latest("viewport-picking");
    if (outcome === "message") picking.reply({ failed: true });
    if (outcome === "error") picking.onerror?.({ message: "Picking failed" });
    if (outcome === "dispose") item.geometry.dispose();
    if (outcome === "timeout") await vi.advanceTimersByTimeAsync(120_000);
    await ready;
    await vi.advanceTimersByTimeAsync(500);
    expect(yielded).toBe(true);
    expect(phase).toBe("scheduled");
    expect(backgroundMeshPreparation(source).phase).toBe("pending");
    expect(latest("processing-worker")).not.toBe(background);
    if (picking) expect(picking.terminated).toBe(true);
  },
);

it("releases a cancelled queued picking job without resuming ahead of the active one", async () => {
  const source = new Float32Array(9);
  const a = mesh(),
    b = mesh();
  const first = prepareViewportPicking(a);
  const second = prepareViewportPicking(b);
  prepareMeshInBackground(source);
  b.geometry.dispose();
  await second;
  await vi.advanceTimersByTimeAsync(500);
  const phase = backgroundMeshPreparation(source).phase;
  latest("viewport-picking").reply({ failed: true });
  await first;
  await vi.advanceTimersByTimeAsync(500);
  expect(phase).toBe("scheduled");
  expect(backgroundMeshPreparation(source).phase).toBe("pending");
});

it("keeps a foreground diagnostics owner while picking prepares", async () => {
  const source = new Float32Array(9);
  prepareMeshInBackground(source);
  await vi.advanceTimersByTimeAsync(500);
  const background = latest("processing-worker");
  const leave = observeScanDiagnostics(source, () => {});
  const ready = prepareViewportPicking(mesh());
  const preserved = !background.terminated;
  latest("viewport-picking").reply({ failed: true });
  await ready;
  leave();
  expect(preserved).toBe(true);
  expect(backgroundMeshPreparation(source).phase).toBe("pending");
});

it("keeps preparation promised to a queued topology operation", async () => {
  const source = new Float32Array(9);
  prepareMeshInBackground(source);
  await vi.advanceTimersByTimeAsync(500);
  const background = latest("processing-worker");
  const inventory = processMesh(
    { kind: "scanEdit", action: "inventory", positions: source },
    { reuseTopology: true },
  );
  const ready = prepareViewportPicking(mesh());
  const preserved = !background.terminated;
  latest("viewport-picking").reply({ failed: true });
  await ready;
  background.reply({ result: { kind: "report", diagnostics: {} } });
  await vi.advanceTimersByTimeAsync(0);
  background.reply({ result: { kind: "scanEdit", diagnostics: {} } });
  await inventory;
  expect(preserved).toBe(true);
});
