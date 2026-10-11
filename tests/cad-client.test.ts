import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CadClient } from "../src/cad/client";
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
