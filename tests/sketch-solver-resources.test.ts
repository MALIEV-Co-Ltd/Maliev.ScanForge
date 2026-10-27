import { afterEach, expect, it, vi } from "vitest";
import * as sketchModule from "../src/sketch";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { Sketch } from "../src/sketch";

const apis: ApplicationApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function large(): Sketch {
  return {
    version: 1,
    points: Array.from({ length: 300 }, (_, i) => ({
      id: `p${i}`,
      x: i,
      y: 0,
    })),
    segments: [],
    constraints: [
      { id: "distance", kind: "distance", a: "p0", b: "p1", value: 2 },
    ],
  };
}

/** Real old solver fails safely at its first big Jacobian row, never allocates a dense matrix. */
function allocationSentinel<T>(run: () => T) {
  const original = globalThis.Array;
  let blocked = 0,
    value: T | undefined,
    error: unknown;
  const rejectLarge = (args: unknown[]) => {
    if (args.length === 1 && typeof args[0] === "number" && args[0] >= 512) {
      blocked++;
      throw Error(
        "Test allocation sentinel: solver reached an oversized dense/Jacobian allocation",
      );
    }
  };
  vi.stubGlobal(
    "Array",
    new Proxy(original, {
      apply(target, thisArg, args) {
        rejectLarge(args);
        return Reflect.apply(target, thisArg, args);
      },
      construct(target, args, newTarget) {
        rejectLarge(args);
        return Reflect.construct(target, args, newTarget);
      },
    }),
  );
  try {
    value = run();
  } catch (failure) {
    error = failure;
  } finally {
    vi.stubGlobal("Array", original);
  }
  return { blocked, value, error };
}

it("rejects real dense solver work before its first oversized allocation and preserves the admitted graph", () => {
  const source = large(),
    before = JSON.stringify(source);
  sketchModule.validateSketch(source);
  const observed = allocationSentinel(() => sketchModule.solveSketch(source));
  expect(observed.error).toMatchObject({ name: "SketchSolverResourceLimit" });
  expect(observed.blocked).toBe(0);
  expect(JSON.stringify(source)).toBe(before);
});

it("bounds the empty-residual Jacobian vector-copy path before its quadratic work", () => {
  const source = large();
  source.points = Array.from({ length: 1000 }, (_, i) => ({
    id: `p${i}`,
    x: i,
    y: 0,
  }));
  source.constraints = [];
  const original = Array.prototype[Symbol.iterator];
  let blocked = 0,
    error: unknown;
  vi.spyOn(Array.prototype, Symbol.iterator).mockImplementation(function (
    this: unknown[],
  ) {
    if (this.length >= 1500 && typeof this[0] === "number") {
      blocked++;
      throw Error("Test vector-copy sentinel");
    }
    return original.call(this);
  });
  try {
    sketchModule.solveSketch(source);
  } catch (failure) {
    error = failure;
  } finally {
    vi.restoreAllMocks();
  }
  expect(error).toMatchObject({ name: "SketchSolverResourceLimit" });
  expect(blocked).toBe(0);
  expect(source.points).toHaveLength(1000);
});

it("charges repeated solver iterations against one work budget, rather than resetting the budget each iteration", () => {
  const source: Sketch = {
    version: 1,
    points: Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, x: i, y: 0 })),
    segments: [],
    constraints: [{ id: "fixed", kind: "fixed", point: "p0", x: 1, y: 1 }],
  };
  const before = JSON.stringify(source);
  let error: unknown;
  try {
    sketchModule.solveSketch(source);
  } catch (failure) {
    error = failure;
  }
  expect(error).toMatchObject({ name: "SketchSolverResourceLimit" });
  expect(JSON.stringify(source)).toBe(before);
});

it("does not charge hypothetical dense iterations when a larger graph is already satisfied", () => {
  const source = large();
  source.constraints = [
    { id: "fixed", kind: "fixed", point: "p0", x: 0, y: 0 },
  ];
  const result = sketchModule.solveSketch(source);
  expect(result.converged).toBe(true);
  expect(result.iterations).toBe(0);
  expect(result.degreesOfFreedom).toBe(598);
  expect(source.points[0]).toEqual({ id: "p0", x: 0, y: 0 });
});

it("returns explicit unavailable diagnostics without throwing, mutating or allocating oversized solver rows", () => {
  const source = large(),
    before = JSON.stringify(source);
  const inspect = (
    sketchModule as unknown as {
      inspectSketchDiagnostics: (input: Sketch) => unknown;
    }
  ).inspectSketchDiagnostics;
  const observed = allocationSentinel(() => inspect(source));
  expect(observed.error).toBeUndefined();
  expect(observed.value).toMatchObject({
    available: false,
    code: "RESOURCE_LIMIT",
    message: expect.stringMatching(/smaller|split|budget|limit/i),
  });
  expect(observed.blocked).toBe(0);
  expect(JSON.stringify(source)).toBe(before);
});

it("distinguishes invalid input from a resource-limited diagnostic and preserves small-sketch results", () => {
  const inspect = (
    sketchModule as unknown as {
      inspectSketchDiagnostics: (input: Sketch) => any;
    }
  ).inspectSketchDiagnostics;
  expect(
    inspect({
      ...sketchModule.rectangleSketch(),
      points: [{ id: "bad", x: NaN, y: 0 }],
    }),
  ).toMatchObject({ available: false, code: "INVALID_SKETCH" });
  const small = sketchModule.rectangleSketch(),
    before = JSON.stringify(small),
    result = inspect(small);
  expect(result).toMatchObject({
    available: true,
    solution: { converged: true, degreesOfFreedom: 0 },
  });
  expect(JSON.stringify(small)).toBe(before);
});

it("keeps resource-limited graphs valid, serializable and readable instead of imposing a project/import cap", () => {
  const source = large();
  const restored = sketchModule.parseSketch(
    sketchModule.serializeSketch(source),
  );
  expect(restored).toEqual(source);
  expect(restored.points).toHaveLength(300);
});

function fixture() {
  const draft = sketchModule.rectangleSketch();
  const state: WorkspaceSnapshot = {
    name: "Solver budget",
    entities: [],
    history: [],
    future: [],
    authoring: { sketch: draft },
    sketchDraft: draft,
    settings: {},
    selectedId: null,
    selection: null,
  };
  const setSketch = vi.fn((next: Sketch) => {
    state.sketchDraft = next;
    state.authoring = { sketch: next };
  });
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => {
      throw Error("No CAD allocation expected");
    },
    setSketch,
    commit: vi.fn(),
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  };
  const api = new ApplicationApi(host, createOperations(host));
  apis.push(api);
  return { state, setSketch, host, api };
}
async function guardedInvoke(
  api: ApplicationApi,
  command: string,
  args: Record<string, unknown>,
) {
  const original = globalThis.Array;
  vi.stubGlobal(
    "Array",
    new Proxy(original, {
      apply(target, thisArg, args) {
        if (args.length === 1 && typeof args[0] === "number" && args[0] >= 512)
          throw Error("Test API allocation sentinel");
        return Reflect.apply(target, thisArg, args);
      },
    }),
  );
  try {
    return await api.invoke(command, args);
  } finally {
    vi.stubGlobal("Array", original);
  }
}
it("reports typed RESOURCE_LIMIT through read-only MCP solving without touching either history scope", async () => {
  const h = fixture(),
    revision = h.api.currentRevision(),
    before = h.state.sketchDraft;
  const result = await guardedInvoke(h.api, "sketch_solve", {
    sketch: large(),
  });
  expect(result).toMatchObject({
    ok: false,
    error: { code: "RESOURCE_LIMIT" },
  });
  expect(h.state.sketchDraft).toBe(before);
  expect(h.setSketch).not.toHaveBeenCalled();
  expect(h.state.history).toEqual([]);
  expect(h.state.future).toEqual([]);
  expect(h.api.currentRevision()).toBe(revision);
});

it("rejects solving replacement atomically while retaining ordinary large-graph replacement/read access", async () => {
  const h = fixture(),
    before = h.state.sketchDraft,
    revision = h.api.currentRevision(),
    source = large();
  const failed = await guardedInvoke(h.api, "sketch_set", {
    sketch: source,
    solve: true,
    expectedRevision: revision,
    requestId: "solve-large",
  });
  expect(failed).toMatchObject({
    ok: false,
    error: { code: "RESOURCE_LIMIT" },
  });
  expect(h.state.sketchDraft).toBe(before);
  expect(h.setSketch).not.toHaveBeenCalled();
  expect(h.api.currentRevision()).toBe(revision);
  expect(
    await h.api.invoke("sketch_set", {
      sketch: source,
      solve: false,
      expectedRevision: revision,
      requestId: "store-large",
    }),
  ).toMatchObject({ ok: true });
  expect(await h.api.invoke("sketch_get", {})).toMatchObject({
    ok: true,
    result: { sketch: source },
  });
  expect(h.setSketch).toHaveBeenCalledOnce();
});

it("does not trust a generic backend error.code when mapping solver resource failures", async () => {
  const h = fixture(),
    error = Object.assign(Error("Untrusted backend error"), {
      code: "RESOURCE_LIMIT",
    });
  const api = new ApplicationApi(h.host, {
    sketch_solve: () => {
      throw error;
    },
  });
  apis.push(api);
  expect(
    await api.invoke("sketch_solve", {
      sketch: sketchModule.rectangleSketch(),
    }),
  ).toMatchObject({ ok: false, error: { code: "OPERATION_FAILED" } });
});
