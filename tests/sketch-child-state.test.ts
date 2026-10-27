import { deserialize, serialize } from "node:v8";
import { expect, it } from "vitest";
import { SketchConicChild } from "../src/cad/sketch-conic-child";
import { SketchEllipseChild } from "../src/cad/sketch-ellipse-child";

const frame = [
  [1, -0, 0, 10.000000000000002],
  [0, 1, 0, 20],
  [0, 0, 1, 30],
];
const conicPoints = [
  [1, 0, 9],
  [0, 1, 8],
  [-1, 0, 7],
];
const ellipsePoints = [
  [-2, 0, 9],
  [2, 0, 8],
  [0, 1, 7],
];

// Replace only the external kernel boundary; preparation and child lifecycle are real.
function backend() {
  let disposed = false;
  let request: any;
  const control = { fail: false, throw: false, builds: 0 };
  return {
    control,
    get edge() {
      return request;
    },
    snapshot() {
      return {
        disposed,
        kind: request?.kind ?? "empty",
        records: structuredClone(
          request?.points ?? (request ? [request.center] : []),
        ),
        ...(request?.kind === "circle" ? { radius: request.radius } : {}),
      };
    },
    rebuild(input: unknown) {
      control.builds++;
      request = undefined;
      if (control.throw) throw new Error("Kernel restoration failed.");
      if (control.fail || (input as any).radius < 0) return false;
      request = structuredClone(input);
      return true;
    },
    dispose() {
      disposed = true;
      request = undefined;
    },
  };
}

it.each(["arc", "circle"] as const)(
  "roundtrips %s retained backend and failed latest preparation independently",
  (kind) => {
    const sourceBackend = backend();
    const child = new SketchConicChild(kind, sourceBackend);
    child.rebuild({
      kind,
      points: conicPoints,
      frame,
      ...(kind === "arc" ? { close: false } : {}),
    });
    const retained = structuredClone(child.edge);
    child.rebuild({
      kind,
      points: [
        [0, 0, 9],
        [1, 0, 8],
        [3, 0, 7],
      ],
      frame,
      ...(kind === "arc" ? { close: false } : {}),
    });
    const failed = child.snapshot();
    expect(failed.preparation?.fitSucceeded).toBe(false);
    expect(failed.backend.kind).toBe(kind === "arc" ? "arc" : "empty");
    const exported = child.exportState();
    expect(exported.lastBackendRequest).toEqual(retained);
    const state = deserialize(serialize(exported));
    expect(Object.is(state.preparation.frame[0][1], -0)).toBe(true);
    const restoredBackend = backend();
    const restored = SketchConicChild.restoreState(
      state,
      () => restoredBackend,
    );
    const fork = child.fork(backend);
    expect(restored.snapshot()).toEqual(failed);
    expect(fork.snapshot()).toEqual(failed);
    expect(restored.edge).toEqual(kind === "arc" ? retained : undefined);
    expect(restoredBackend.control.builds).toBe(kind === "arc" ? 1 : 0);
    state.preparation.sourceRecords[0][0] = 999;
    state.lastBackendRequest.center[0] = 888;
    expect(restored.snapshot()).toEqual(failed);
    expect(child.snapshot()).toEqual(failed);
    expect(restored.exportState().lastBackendRequest).toEqual(retained);
    child.dispose();
    expect(restored.snapshot().backend.disposed).toBe(false);
    restored.dispose();
    fork.dispose();
  },
);

it("roundtrips ellipse surviving geometry with an empty failed source collection", () => {
  const child = new SketchEllipseChild(frame, backend());
  child.rebuildRecords(ellipsePoints);
  const retained = structuredClone(child.edge);
  child.rebuildRecords([
    [1, 1, 9],
    [1, 1, 8],
    [2, 2, 7],
  ]);
  const failed = child.snapshot();
  expect(failed.preparation?.sourceRecords).toEqual([]);
  expect(failed.preparation?.fitSucceeded).toBe(false);
  const state = deserialize(serialize(child.exportState()));
  const restored = SketchEllipseChild.restoreState(state, backend);
  const fork = child.fork(backend);
  expect(restored.snapshot()).toEqual(failed);
  expect(fork.snapshot()).toEqual(failed);
  expect(restored.edge).toEqual(retained);
  expect(Object.is(restored.exportState().frame[0][1], -0)).toBe(true);
  state.lastBackendRequest.center[0] = 999;
  state.preparation.geometry.center[0] = 888;
  expect(restored.snapshot()).toEqual(failed);
  expect(restored.edge).toEqual(retained);
  child.dispose();
  restored.dispose();
  fork.dispose();
});

it("preserves an empty ellipse backend after a kernel failure without resurrecting retained geometry", () => {
  const sourceBackend = backend();
  const child = new SketchEllipseChild(frame, sourceBackend);
  child.rebuildRecords(ellipsePoints);
  const retained = structuredClone(child.edge);
  sourceBackend.control.throw = true;
  expect(() => child.rebuildRecords(ellipsePoints)).toThrow(/Kernel/);
  const empty = child.snapshot();
  expect(empty.backend.kind).toBe("empty");
  const state = deserialize(serialize(child.exportState()));
  expect(state.lastBackendRequest).toEqual(retained);
  const restoredBackend = backend();
  const restored = SketchEllipseChild.restoreState(
    state,
    () => restoredBackend,
  );
  expect(restored.snapshot()).toEqual(empty);
  expect(restoredBackend.control.builds).toBe(0);
  expect(restored.edge).toBeUndefined();
  child.dispose();
  restored.dispose();
});

it.each(["arc", "circle", "ellipse"] as const)(
  "roundtrips an uninitialized %s child without kernel work",
  (kind) => {
    const child =
      kind === "ellipse"
        ? new SketchEllipseChild(frame, backend())
        : new SketchConicChild(kind, backend());
    const targetBackend = backend();
    const state = deserialize(serialize(child.exportState()));
    const restored =
      kind === "ellipse"
        ? SketchEllipseChild.restoreState(state, () => targetBackend)
        : SketchConicChild.restoreState(state, () => targetBackend);
    expect(restored.snapshot()).toEqual(child.snapshot());
    expect(targetBackend.control.builds).toBe(0);
    child.dispose();
    restored.dispose();
  },
);

it.each(["arc", "ellipse"] as const)(
  "rejects malformed %s state before allocating a backend",
  (kind) => {
    const child =
      kind === "ellipse"
        ? new SketchEllipseChild(frame, backend())
        : new SketchConicChild(kind, backend());
    if (child instanceof SketchEllipseChild)
      child.rebuildRecords(ellipsePoints);
    else child.rebuild({ kind, points: conicPoints, frame, close: false });
    const restore =
      kind === "ellipse"
        ? SketchEllipseChild.restoreState
        : SketchConicChild.restoreState;
    for (const corrupt of [
      (s: any) => {
        s.version = 2;
      },
      (s: any) => {
        s.unexpected = true;
      },
      (s: any) => {
        s.backendEmpty = "yes";
      },
      (s: any) => {
        s.lastBackendRequest = undefined;
      },
      (s: any) => {
        s.lastBackendRequest.kind = "line";
      },
      (s: any) => {
        s.lastBackendRequest.center[0] = Infinity;
      },
      (s: any) => {
        s.preparation.frame[0][0] = NaN;
      },
      (s: any) => {
        s.preparation.sourceRecords[0] = [1, 2];
      },
      (s: any) => {
        s.outcome.backendSucceeded = "yes";
      },
      (s: any) => {
        s.outcome.error = {};
      },
    ]) {
      const state = child.exportState();
      corrupt(state);
      let allocations = 0;
      expect(() =>
        restore(state, () => {
          allocations++;
          return backend();
        }),
      ).toThrow();
      expect(allocations).toBe(0);
    }
    child.dispose();
  },
);

it.each(["arc", "ellipse"] as const)(
  "disposes the new %s backend when restoration fails or aborts",
  (kind) => {
    const child =
      kind === "ellipse"
        ? new SketchEllipseChild(frame, backend())
        : new SketchConicChild(kind, backend());
    if (child instanceof SketchEllipseChild)
      child.rebuildRecords(ellipsePoints);
    else child.rebuild({ kind, points: conicPoints, frame, close: false });
    const restore =
      kind === "ellipse"
        ? SketchEllipseChild.restoreState
        : SketchConicChild.restoreState;
    for (const failure of ["false", "throw", "abort"] as const) {
      const target = backend();
      const controller = new AbortController();
      target.control.fail = failure === "false";
      target.control.throw = failure === "throw";
      const rebuild = target.rebuild.bind(target);
      target.rebuild = (request) => {
        const result = rebuild(request);
        if (failure === "abort") controller.abort();
        return result;
      };
      expect(() =>
        restore(child.exportState(), () => target, controller.signal),
      ).toThrow();
      expect(target.snapshot().disposed).toBe(true);
      expect(child.snapshot().backend.disposed).toBe(false);
    }
    child.dispose();
  },
);
