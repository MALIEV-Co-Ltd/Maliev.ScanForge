import { expect, it } from "vitest";
import { SketchLineChild } from "../src/cad/sketch-line-child";
import type { NativeSketchLineState } from "../src/sketch-line-rebuild";
const initial = (): NativeSketchLineState => ({
  frame: [
    [1, 0, 0, 10],
    [0, 1, 0, 20],
    [0, 0, 1, 30],
  ],
  start: [1, 2, 3],
  middle: [3, 4, 5],
  end: [5, 6, 7],
  sourceRecords: [
    [10, 20, 0],
    [30, 40, 0],
  ],
});
function fixture(results: (boolean | Error)[] = [true]) {
  const requests: any[] = [];
  let disposed = false,
    hasCurve = false,
    midpointCalls = 0;
  let onBuild: (() => void) | undefined;
  const edge = {};
  const backend = {
    get edge() {
      if (disposed) throw Error("disposed");
      return hasCurve ? edge : undefined;
    },
    snapshot: () => ({ disposed, hasCurve }),
    rebuild(input: unknown) {
      requests.push(structuredClone(input));
      hasCurve = true;
      onBuild?.();
      const result = results.shift() ?? false;
      if (result instanceof Error) throw result;
      return result;
    },
    midpoint() {
      midpointCalls++;
      return [9, 8, 7] as const;
    },
    dispose() {
      disposed = true;
      hasCurve = false;
    },
  };
  const child = new SketchLineChild(initial(), backend);
  return {
    child,
    backend,
    requests,
    get midpointCalls() {
      return midpointCalls;
    },
    set onBuild(f: (() => void) | undefined) {
      onBuild = f;
    },
  };
}
it("starts detached and does not invent backend success", () => {
  const state = initial();
  const f = fixture();
  const snapshot = f.child.snapshot();
  expect(snapshot.state).toEqual(state);
  expect(snapshot.outcome).toBeUndefined();
  (snapshot.state!.start as [number, number, number])[0] = 100;
  expect(f.child.snapshot().state!.start[0]).toBe(1);
  expect(f.requests).toHaveLength(0);
  expect(f.child.edge).toBeUndefined();
  f.child.dispose();
});
it("publishes flattened fields and sources only after actual backend success", () => {
  const f = fixture();
  const records = [
    [2, 3, 4],
    [6, 7, 8],
  ];
  const result = f.child.replaceLocalRecords(records);
  expect(result.builderSucceeded).toBe(true);
  expect(result.attempts).toHaveLength(1);
  expect(f.requests[0]).toEqual({ kind: "line", points: records });
  expect(f.midpointCalls).toBe(1);
  expect(f.child.snapshot().state).toEqual({
    ...initial(),
    start: [2, 3, 0],
    middle: [9, 8, 0],
    end: [6, 7, 0],
    sourceRecords: [
      [2, 3, 0],
      [6, 7, 0],
    ],
  });
  records[0][0] = 100;
  result.attempts[0].builderSucceeded = false;
  expect(f.child.snapshot().outcome!.builderSucceeded).toBe(true);
  expect(f.child.edge).toBeDefined();
  f.child.dispose();
});
it("failed backend retains proposed XYZ fields and previous sources even if an edge exists", () => {
  const f = fixture([false]);
  const result = f.child.replaceLocalRecords([
    [2, 3, 4],
    [6, 7, 8],
  ]);
  expect(result.builderSucceeded).toBe(false);
  expect(f.child.edge).toBeDefined();
  expect(f.midpointCalls).toBe(0);
  expect(f.child.snapshot().state).toEqual({
    ...initial(),
    start: [2, 3, 4],
    middle: [4, 5, 6],
    end: [6, 7, 8],
  });
  f.child.dispose();
});
it("collection coincidence skips the backend and preserves state", () => {
  const f = fixture();
  const result = f.child.rebuildRecords([
    [1, 2, 99],
    [1, 2, 100],
    [9, 8, 7],
  ]);
  expect(result.admitted).toBe(false);
  expect(result.attempts).toEqual([]);
  expect(f.requests).toEqual([]);
  expect(f.child.snapshot().state).toEqual(initial());
  f.child.dispose();
});
it("collection rebuild uses first two XY records while local replacement uses first and last XYZ", () => {
  const f = fixture([false, false]);
  f.child.rebuildRecords([
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ]);
  expect(f.requests[0].points).toEqual([
    [1, 2, 0],
    [4, 5, 0],
  ]);
  f.child.replaceLocalRecords([
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ]);
  expect(f.requests[1].points).toEqual([
    [1, 2, 3],
    [7, 8, 9],
  ]);
  f.child.dispose();
});
it("unadmitted point edit preserves both backend and source state", () => {
  const f = fixture();
  const result = f.child.editPoint(1, [1, 2, 3]);
  expect(result.admitted).toBe(false);
  expect(f.requests).toHaveLength(0);
  expect(f.child.snapshot().state).toEqual(initial());
  f.child.dispose();
});
it("successful point edit skips recovery", () => {
  const f = fixture();
  const result = f.child.editPoint(0, [9, 8, 7]);
  expect(result.admitted).toBe(true);
  expect(result.builderSucceeded).toBe(true);
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0].points).toEqual([
    [9, 8, 7],
    [5, 6, 7],
  ]);
  f.child.dispose();
});
it("admitted point edit executes old-start/old-start recovery after false, with independent outcomes", () => {
  const f = fixture([false, false]);
  const result = f.child.editPoint(0, [9, 8, 7]);
  expect(result.admitted).toBe(true);
  expect(result.builderSucceeded).toBe(false);
  expect(result.attempts.map((x) => x.backendSucceeded)).toEqual([
    false,
    false,
  ]);
  expect(f.requests.map((x) => x.points)).toEqual([
    [
      [9, 8, 7],
      [5, 6, 7],
    ],
    [
      [1, 2, 3],
      [1, 2, 3],
    ],
  ]);
  expect(f.child.snapshot().state).toEqual({
    ...initial(),
    start: [1, 2, 3],
    middle: [1, 2, 3],
    end: [1, 2, 3],
  });
  expect(f.midpointCalls).toBe(0);
  f.child.dispose();
});
it("backend exceptions do not trigger the boolean-failure recovery route", () => {
  const f = fixture([Error("build failed")]);
  expect(() => f.child.editPoint(1, [9, 8, 7])).toThrow("build failed");
  expect(f.requests).toHaveLength(1);
  expect(f.child.snapshot().outcome!.attempts[0].error).toBe("build failed");
  expect(f.child.snapshot().state!.end).toEqual([9, 8, 7]);
  expect(f.child.snapshot().state!.sourceRecords).toEqual(
    initial().sourceRecords,
  );
  f.child.dispose();
});
it("placed replacement and raw local transform keep their separate frame semantics", () => {
  const f = fixture([false, false]);
  f.child.replacePlacedRecords(
    [
      [11, 22, 33],
      [15, 26, 37],
    ],
    initial().frame,
  );
  expect(f.requests[0].points).toEqual([
    [1, 2, 3],
    [5, 6, 7],
  ]);
  f.child.transformLocalPoints([
    [1, 0, 0, 1],
    [0, 1, 0, 2],
    [0, 0, 1, 3],
  ]);
  expect(f.requests[1].points).toEqual([
    [2, 4, 6],
    [6, 8, 10],
  ]);
  expect(f.child.snapshot().state!.frame).toEqual(initial().frame);
  f.child.dispose();
});
it("malformed input and pre-abort preserve state and do not touch the backend", () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    f.child.replaceLocalRecords([[1, 2, 3]], controller.signal),
  ).toThrow(/cancelled/);
  expect(() => f.child.replaceLocalRecords([])).toThrow();
  expect(() => f.child.editPoint(2, [1, 2, 3])).toThrow();
  expect(f.requests).toHaveLength(0);
  expect(f.child.snapshot().state).toEqual(initial());
  f.child.dispose();
});
it("post-build cancellation retires the staged child before any recovery or midpoint query", () => {
  const f = fixture([false]);
  const controller = new AbortController();
  f.onBuild = () => controller.abort();
  expect(() => f.child.editPoint(1, [9, 8, 7], controller.signal)).toThrow(
    /cancelled/,
  );
  expect(f.requests).toHaveLength(1);
  expect(f.midpointCalls).toBe(0);
  expect(f.child.snapshot().disposed).toBe(true);
  expect(f.child.snapshot().state).toBeUndefined();
  expect(() => f.child.edge).toThrow(/disposed/);
  f.child.dispose();
});
it("disposal is idempotent and rejects subsequent edits", () => {
  const f = fixture();
  f.child.dispose();
  f.child.dispose();
  expect(f.backend.snapshot().disposed).toBe(true);
  expect(() =>
    f.child.rebuildRecords([
      [1, 2, 3],
      [4, 5, 6],
    ]),
  ).toThrow(/disposed/);
  expect(() => new SketchLineChild(initial(), f.backend)).toThrow(/owned/);
});

it("disposal during a backend callback cannot resurrect child state", () => {
  const f = fixture();
  f.onBuild = () => f.child.dispose();
  expect(() =>
    f.child.replaceLocalRecords([
      [1, 2, 3],
      [4, 5, 6],
    ]),
  ).toThrow(/disposed/);
  expect(f.child.snapshot().disposed).toBe(true);
  expect(f.child.snapshot().state).toBeUndefined();
  expect(f.midpointCalls).toBe(0);
});
it("cancellation retains cleanup failure as well as the abort reason", () => {
  const f = fixture();
  const controller = new AbortController();
  f.onBuild = () => controller.abort();
  f.backend.dispose = () => {
    throw new Error("retirement failed");
  };
  expect(() =>
    f.child.replaceLocalRecords(
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
      controller.signal,
    ),
  ).toThrow(AggregateError);
  expect(f.child.snapshot().disposed).toBe(true);
});
it("midpoint failures preserve proposed fields and old sources without retrying", () => {
  const f = fixture();
  f.backend.midpoint = () => {
    throw Error("midpoint failed");
  };
  expect(() => f.child.editPoint(1, [9, 8, 7])).toThrow("midpoint failed");
  expect(f.requests).toHaveLength(1);
  expect(f.child.snapshot().state!.sourceRecords).toEqual(
    initial().sourceRecords,
  );
  expect(f.child.snapshot().outcome!.attempts[0].backendSucceeded).toBe(true);
  f.child.dispose();
});

it("cannot attach an already-owned fresh backend to a second child", () => {
  const f = fixture();
  expect(() => new SketchLineChild(initial(), f.backend)).toThrow(/owned/);
  f.child.dispose();
});
