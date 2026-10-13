import { afterEach, expect, it, vi } from "vitest";
import { processMesh, type ProcessingRequest } from "../src/processing-client";
import { releaseProcessingSession } from "../src/processing-session";

afterEach(() => {
  releaseProcessingSession();
  vi.unstubAllGlobals();
});
it("clones point positions, normals and masks and terminates the exact worker on cancellation", async () => {
  let worker: PointWorker;
  class PointWorker {
    sent?: ProcessingRequest;
    transfers?: Transferable[];
    onmessage: unknown;
    onerror: unknown;
    onmessageerror: unknown;
    terminated = false;
    constructor() {
      worker = this;
    }
    postMessage(request: ProcessingRequest, transfers: Transferable[]) {
      this.sent = request;
      this.transfers = transfers;
    }
    terminate() {
      this.terminated = true;
    }
  }
  vi.stubGlobal("Worker", PointWorker);
  const positions = new Float32Array([0, 0, 0, 1, 0, 0]),
    normals = new Float32Array([1, 0, 0, 0, 1, 0]),
    selection = Uint8Array.from([1, 0]);
  const controller = new AbortController();
  const result = processMesh(
    { kind: "pointCloudEdit", action: "delete", positions, normals, selection },
    { signal: controller.signal },
  );
  expect(worker!.sent).toMatchObject({
    kind: "pointCloudEdit",
    positions,
    normals,
    selection,
  });
  const sent = worker!.sent!;
  if (sent.kind !== "pointCloudEdit") throw Error("Wrong request");
  expect(sent.positions).not.toBe(positions);
  expect(sent.normals).not.toBe(normals);
  expect(sent.selection).not.toBe(selection);
  expect(worker!.transfers).toHaveLength(3);
  controller.abort();
  await expect(result).rejects.toThrow("cancelled");
  expect(worker!.terminated).toBe(true);
  expect(positions).toHaveLength(6);
  expect(normals).toHaveLength(6);
  expect(Array.from(selection)).toEqual([1, 0]);
});
