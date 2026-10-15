import { expect, it, vi } from "vitest";
import {
  InteractiveMirrorController,
  type InteractiveMirrorRequest,
  type InteractiveMirrorSink,
} from "../src/interactive-mirror-controller";
import type { InteractiveMirrorBackend } from "../src/interactive-mirror-backend";
import { nativeInteractiveMirrorPoints } from "../src/interactive-mirror-selection";
const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const request = (direction = [0, 0, 1]): InteractiveMirrorRequest => ({
  poses: [{ entityId: "scan", matrix: pose }],
  plane: 1,
  settings: {
    direction,
    stride: 0,
    baseColor: [0.8, 0.8, 0],
    selectedColor: [0.3, 0.4, 0.5],
    allowanceMilliseconds: 1000000,
    elapsedMilliseconds: 0,
  },
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
function fixture(gate?: ReturnType<typeof deferred>) {
  const data = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, -1, 0, 0, 1]),
    flags: new Uint32Array([2, 0, 2]),
  };
  let active = 0,
    maxActive = 0;
  const backend: InteractiveMirrorBackend = {
    entityIds: ["scan"],
    source: vi.fn(async () => data),
    prepare: vi.fn(async (_id, settings, includeColors) => {
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        if (gate) {
          const waiting = gate;
          gate = undefined;
          await waiting.promise;
        }
        const p = nativeInteractiveMirrorPoints(
          { ...settings, normals: data.normals, flags: data.flags },
          { sourceColors: includeColors, indicesOnly: !includeColors },
        );
        return {
          ...p,
          colors: includeColors ? p.colors : undefined,
          execution: {
            physicalWorkers: 0,
            partitions: 1,
            preparationMilliseconds: 0,
            fallbackReason: "test",
          },
        };
      } finally {
        active--;
      }
    }),
  };
  const sinks: InteractiveMirrorSink[] = [];
  const create = vi.fn(() => {
    const sink = {
      show: vi.fn(),
      publish: vi.fn(),
      prepare: vi.fn(async () => true),
      dispose: vi.fn(),
    };
    sinks.push(sink);
    return sink;
  });
  const onError = vi.fn();
  const controller = new InteractiveMirrorController(backend, {
    create,
    onError,
  });
  return {
    controller,
    backend,
    create,
    sinks,
    data,
    onError,
    get maxActive() {
      return maxActive;
    },
  };
}
it("coalesces camera requests to one active preparation and never publishes the stale result", async () => {
  const gate = deferred(),
    f = fixture(gate);
  f.controller.update(request());
  await vi.waitFor(() => expect(f.backend.prepare).toHaveBeenCalledTimes(1));
  for (let i = 1; i <= 100; i++) f.controller.update(request([i / 100, 0, -1]));
  gate.resolve();
  await f.controller.settled();
  expect(f.backend.prepare).toHaveBeenCalledTimes(2);
  expect(f.backend.source).toHaveBeenCalledTimes(1);
  expect(f.maxActive).toBe(1);
  expect(f.sinks[0].publish).toHaveBeenCalledTimes(1);
  const expected = nativeInteractiveMirrorPoints(
    {
      ...request([1, 0, -1]).settings,
      normals: f.data.normals,
      flags: f.data.flags,
    },
    { sourceColors: true },
  );
  expect(vi.mocked(f.sinks[0].publish).mock.calls[0][1].indices).toEqual(
    expected.indices,
  );
  expect(f.controller.inspect()).toMatchObject({
    pending: false,
    error: null,
    ready: true,
  });
  f.controller.dispose();
});
it("updates poses and reflection with GPU matrices only and keeps warm view updates colorless", async () => {
  const f = fixture();
  f.controller.update(request());
  await f.controller.settled();
  const changed = request();
  changed.plane = 2;
  changed.poses = [
    { entityId: "scan", matrix: pose.map((v, i) => (i === 3 ? 42 : v)) },
  ];
  for (let i = 0; i < 100; i++) f.controller.update(changed);
  expect(f.backend.prepare).toHaveBeenCalledTimes(1);
  expect(f.backend.source).toHaveBeenCalledTimes(1);
  expect(f.sinks[0].show).toHaveBeenLastCalledWith(changed.poses, 2);
  f.controller.update(request([0, 0, -1]));
  await f.controller.settled();
  expect(vi.mocked(f.backend.prepare).mock.calls.at(-1)?.[2]).toBe(false);
  f.controller.update(request([0, 0, 0]));
  await f.controller.settled();
  expect(vi.mocked(f.backend.prepare).mock.calls.at(-1)?.[2]).toBe(true);
  const styled = request([0, 0, 0]);
  styled.settings.selectedColor = [1, 0, 0];
  f.controller.update(styled);
  await f.controller.settled();
  expect(vi.mocked(f.backend.prepare).mock.calls.at(-1)?.[2]).toBe(true);
  expect(f.data.positions.byteLength).toBe(36);
  f.controller.dispose();
});
it("clears immediately while preparation is pending without publishing or closing the borrowed backend", async () => {
  const gate = deferred(),
    f = fixture(gate);
  f.controller.update(request());
  await vi.waitFor(() => expect(f.backend.prepare).toHaveBeenCalledTimes(1));
  f.controller.update(null);
  gate.resolve();
  await f.controller.settled();
  expect(f.sinks[0].dispose).toHaveBeenCalledTimes(1);
  expect(f.sinks[0].publish).not.toHaveBeenCalled();
  expect(f.onError).not.toHaveBeenCalled();
  f.controller.update(request());
  await f.controller.settled();
  expect(f.create).toHaveBeenCalledTimes(2);
  expect(f.backend.source).toHaveBeenCalledTimes(1);
  expect(f.sinks[1].publish).toHaveBeenCalledTimes(1);
  f.controller.dispose();
});
it("does not recreate disposed graphics when a source resolves after cancellation", async () => {
  const gate = deferred(),
    f = fixture();
  vi.mocked(f.backend.source).mockImplementation(async () => {
    await gate.promise;
    return f.data;
  });
  f.controller.update(request());
  f.controller.dispose();
  gate.resolve();
  await f.controller.settled();
  expect(f.create).not.toHaveBeenCalled();
  expect(f.backend.prepare).not.toHaveBeenCalled();
  expect(() => f.controller.update(request())).toThrow(/closed/);
});
it("retains a bounded failure status and retries only when explicitly requested", async () => {
  const f = fixture();
  vi.mocked(f.backend.prepare).mockRejectedValueOnce(
    new Error("source expired"),
  );
  f.controller.update(request());
  await f.controller.settled();
  expect(f.controller.inspect()).toMatchObject({
    pending: false,
    ready: false,
    error: "source expired",
  });
  for (let i = 0; i < 100; i++) f.controller.update(request());
  await f.controller.settled();
  expect(f.backend.prepare).toHaveBeenCalledTimes(1);
  expect(f.onError).toHaveBeenCalledTimes(1);
  f.controller.retry();
  await f.controller.settled();
  expect(f.controller.inspect()).toMatchObject({ ready: true, error: null });
  f.controller.dispose();
});
it("validates all borrowed targets, poses and draw settings before changing a live request", async () => {
  const f = fixture();
  f.controller.update(request());
  await f.controller.settled();
  const shows = vi.mocked(f.sinks[0].show).mock.calls.length;
  for (const edit of [
    (r: InteractiveMirrorRequest) =>
      (r.poses = [...r.poses, { entityId: "missing", matrix: pose }]),
    (r: InteractiveMirrorRequest) => (r.plane = 9),
    (r: InteractiveMirrorRequest) => (r.settings.stride = -1),
    (r: InteractiveMirrorRequest) => (r.settings.direction = [NaN, 0, 1]),
  ]) {
    const r = request();
    edit(r);
    expect(() => f.controller.update(r)).toThrow();
  }
  expect(vi.mocked(f.sinks[0].show).mock.calls.length).toBe(shows);
  expect(f.controller.inspect()).toMatchObject({ ready: true, error: null });
  f.controller.dispose();
});

it("does not invalidate a static viewport repeatedly for identical requests", async () => {
  const f = fixture();
  f.controller.update(request());
  await f.controller.settled();
  const shows = vi.mocked(f.sinks[0].show).mock.calls.length;
  for (let i = 0; i < 100; i++) f.controller.update(request());
  await f.controller.settled();
  expect(vi.mocked(f.sinks[0].show).mock.calls.length).toBe(shows);
  expect(f.backend.prepare).toHaveBeenCalledTimes(1);
  f.controller.dispose();
});
it("restores all draw lists when returning to a previously completed view after a partial multi-scan failure", async () => {
  const f = fixture();
  Object.assign(f.backend, { entityIds: ["scan", "other"] });
  const initial = request();
  initial.poses = [...initial.poses, { entityId: "other", matrix: pose }];
  f.controller.update(initial);
  await f.controller.settled();
  const original = vi.mocked(f.backend.prepare).getMockImplementation()!;
  vi.mocked(f.backend.prepare).mockImplementation(async (...args) => {
    if (args[0] === "other" && args[1].direction[2] < 0)
      throw new Error("second scan failed");
    return original(...args);
  });
  const next = request([0, 0, -1]);
  next.poses = initial.poses;
  f.controller.update(next);
  await f.controller.settled();
  expect(f.controller.inspect().error).toBe("second scan failed");
  const calls = vi.mocked(f.backend.prepare).mock.calls.length;
  f.controller.update(initial);
  await f.controller.settled();
  expect(vi.mocked(f.backend.prepare).mock.calls.length).toBe(calls + 1);
  expect(vi.mocked(f.sinks[0].publish).mock.calls.at(-1)?.[0]).toBe("scan");
  expect(vi.mocked(f.sinks[0].publish).mock.calls.at(-1)?.[1].indices).toEqual(
    new Uint32Array([0, 2]),
  );
  f.controller.dispose();
});
