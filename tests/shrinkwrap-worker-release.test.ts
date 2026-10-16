import { expect, it, vi } from "vitest";
import {
  acquireProcessingSession,
  releaseProcessingPreview,
  releaseProcessingSession,
} from "../src/processing-session";
it("queues id-specific preview release even while its existing worker is active", () => {
  const positions = new Float32Array(9);
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
  } as unknown as Worker;
  const session = acquireProcessingSession(positions, () => worker)!;
  try {
    releaseProcessingPreview(positions, "matching");
    expect(worker.postMessage).toHaveBeenCalledWith({
      releasePreviewId: "matching",
    });
    releaseProcessingPreview(new Float32Array(9), "different");
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  } finally {
    session.release(false);
    releaseProcessingSession();
  }
  expect(worker.terminate).toHaveBeenCalledOnce();
});
