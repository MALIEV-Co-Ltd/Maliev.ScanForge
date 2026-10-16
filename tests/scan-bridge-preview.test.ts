import { expect, it, vi } from "vitest";
import { BridgePreviewController } from "../src/scan-bridge-preview";
import type { ScanEditResult } from "../src/scan-edit";

const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const result = (): ScanEditResult => ({
  positions: new Float32Array([...source, 0, 0, 0, 1, 0, 0, 1, 1, 0]),
  diagnostics: { filledHoles: 1, addedTriangles: 1, method: "flat" },
});
const op = {
  action: "fillHoles" as const,
  mode: "bridge" as const,
  indices: [0],
  start: 0,
  end: 2,
  algorithm: "automatic" as const,
};
function harness() {
  const pending: {
    resolve: (r: ScanEditResult) => void;
    signal: AbortSignal;
  }[] = [];
  const display = vi.fn(),
    commit = vi.fn(),
    status = vi.fn(),
    error = vi.fn();
  const generate = vi.fn(
    (_op: unknown, signal: AbortSignal) =>
      new Promise<ScanEditResult>((resolve) =>
        pending.push({ resolve, signal }),
      ),
  );
  const controller = new BridgePreviewController(source, generate, {
    display,
    commit,
    status,
    error,
  });
  return { controller, pending, display, commit, status, error, generate };
}
it("shows an uncommitted preview and reuses its exact mesh once on release", async () => {
  const h = harness();
  h.controller.request(op, false);
  const mesh = result();
  h.pending[0].resolve(mesh);
  await Promise.resolve();
  expect(h.display).toHaveBeenLastCalledWith(
    new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
  );
  expect(h.commit).not.toHaveBeenCalled();
  h.controller.request(op, true);
  await Promise.resolve();
  expect(h.generate).toHaveBeenCalledTimes(1);
  expect(h.commit).toHaveBeenCalledExactlyOnceWith(
    mesh.positions,
    "Bridge mesh edges",
  );
});
it("ignores stale results after moving endpoints, cancellation, and disposal", async () => {
  const h = harness();
  h.controller.request(op, false);
  h.controller.request({ ...op, end: 3 }, false);
  expect(h.pending[0].signal.aborted).toBe(true);
  h.pending[0].resolve(result());
  await Promise.resolve();
  expect(h.display.mock.calls.some(([p]) => p?.length)).toBe(false);
  h.controller.request(null, false);
  expect(h.pending[1].signal.aborted).toBe(true);
  h.pending[1].resolve(result());
  await Promise.resolve();
  h.controller.dispose();
  expect(h.commit).not.toHaveBeenCalled();
});
it("waits for a released endpoint's pending preview and rejects empty patches", async () => {
  const h = harness();
  h.controller.request(op, false);
  h.controller.request(op, true);
  expect(h.commit).not.toHaveBeenCalled();
  h.pending[0].resolve({
    ...result(),
    positions: source,
    diagnostics: { filledHoles: 0, addedTriangles: 0 },
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(h.commit).not.toHaveBeenCalled();
  expect(h.error).toHaveBeenCalled();
});
