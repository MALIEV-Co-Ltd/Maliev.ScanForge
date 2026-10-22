import { describe, expect, it, vi } from "vitest";
import {
  constrainSketch,
  parseSketch,
  removeSketchGeometry,
  serializeSketch,
  solveSketch,
  validateSketch,
  type Sketch,
  type SketchConstraint,
} from "../src/sketch";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { CadClient } from "../src/cad/client";

const relation = (): SketchConstraint =>
  ({
    id: "join",
    kind: "collinear",
    first: "first",
    second: "second",
  }) as SketchConstraint;

function source(): Sketch {
  return {
    version: 1,
    points: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 10, y: 0 },
      { id: "c", x: 20, y: 2 },
      { id: "d", x: 30, y: 4 },
    ],
    segments: [
      { id: "first", a: "a", b: "b", construction: true },
      { id: "second", a: "c", b: "d" },
    ],
    constraints: [],
  };
}
function fix(sketch: Sketch, ids = ["a", "b"]) {
  sketch.constraints.push(
    ...ids.map((id) => {
      const p = sketch.points.find((p) => p.id === id)!;
      return {
        id: `fix-${id}`,
        kind: "fixed" as const,
        point: id,
        x: p.x,
        y: p.y,
      };
    }),
  );
  return sketch;
}
function distances(sketch: Sketch) {
  const [a, b, c, d] = sketch.points;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return [c, d].map(
    (p) => ((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / length,
  );
}

describe("collinear straight sketch segments", () => {
  it.each([0, Math.PI / 2, 0.71])(
    "solves separated endpoints on a translated line at %s radians",
    (angle) => {
      const sketch = source();
      for (const p of sketch.points) {
        const { x, y } = p;
        p.x = 17 + Math.cos(angle) * x - Math.sin(angle) * y;
        p.y = -9 + Math.sin(angle) * x + Math.cos(angle) * y;
      }
      fix(sketch);
      const before = structuredClone(sketch);
      const next = constrainSketch(sketch, relation());
      expect(
        distances(next).every((d) => Math.abs(d) < 2e-6),
        JSON.stringify(next.points),
      ).toBe(true);
      expect(next.points.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
      expect(next.segments).toEqual(before.segments);
      expect(sketch).toEqual(before);
      expect(solveSketch(next).degreesOfFreedom).toBe(2);
    },
  );

  it.each([false, true])(
    "accepts opposite endpoint direction with swapped references=%s",
    (swapped) => {
      const sketch = fix(source());
      sketch.segments[1] = { id: "second", a: "d", b: "c" };
      const c = relation();
      if (swapped && "first" in c) [c.first, c.second] = [c.second, c.first];
      const next = constrainSketch(sketch, c);
      const ordered = swapped
        ? {
            ...next,
            points: [...next.points.slice(2), ...next.points.slice(0, 2)],
          }
        : next;
      expect(distances(ordered).every((d) => Math.abs(d) < 1e-6)).toBe(true);
      // Extrapolating from the other supporting line amplifies its endpoint residual.
      expect(distances(next).every((d) => Math.abs(d) < 1e-5)).toBe(true);
    },
  );

  it("retains disjoint and overlapping collinear lines without welding or constraining their lengths", () => {
    const sketch = source();
    sketch.points[2].y = sketch.points[3].y = 0;
    sketch.points[3].x = 25;
    sketch.constraints.push(relation());
    const solution = solveSketch(sketch);
    expect(solution.converged).toBe(true);
    expect(solution.iterations).toBe(0);
    expect(solution.degreesOfFreedom).toBe(6);
    expect(solution.sketch).toEqual(sketch);
    sketch.points[2].x = 2;
    expect(solveSketch(sketch).converged).toBe(true);
  });

  it("attributes both residual rows to the collinear relation without consuming following constraints", () => {
    const sketch = fix(source(), ["a", "b", "c", "d"]);
    sketch.constraints.unshift(relation());
    sketch.constraints.push({
      id: "length",
      kind: "distance",
      a: "c",
      b: "d",
      value: Math.hypot(10, 2),
    });
    const solved = solveSketch(sketch, 1e-6, 0);
    expect(solved.converged).toBe(false);
    expect(solved.conflictingConstraintIds).toEqual(["join"]);
    expect(solved.maxResidual).toBe(4);
    expect(() =>
      constrainSketch(
        { ...sketch, constraints: sketch.constraints.slice(1) },
        relation(),
      ),
    ).toThrow(/conflict|unsolved/i);
  });

  it.each(["same", "missing", "zero-first", "zero-second", "short", "arc"])(
    "rejects %s references before solving",
    (kind) => {
      const sketch = source();
      const c = relation() as SketchConstraint & {
        first: string;
        second: string;
      };
      if (kind === "same") c.second = c.first;
      if (kind === "missing") c.second = "missing";
      if (kind === "zero-first")
        Object.assign(sketch.points[1], { x: 0, y: 0 });
      if (kind === "zero-second")
        Object.assign(sketch.points[3], { x: 20, y: 2 });
      if (kind === "short") sketch.points[1].x = 1e-12;
      if (kind === "arc") {
        sketch.points.push({ id: "center", x: 25, y: 3 });
        sketch.arcs = [
          { id: "arc", a: "c", b: "d", center: "center", clockwise: false },
        ];
        c.second = "arc";
      }
      sketch.constraints.push(c);
      expect(() => validateSketch(sketch)).toThrow(
        /collinear|segment|distinct/i,
      );
    },
  );

  it("round-trips placement and removes the relation only when a referenced segment is deleted", () => {
    const sketch = source();
    sketch.frame = {
      origin: [1, 2, 3],
      u: [0, 1, 0],
      v: [0, 0, 1],
      normal: [1, 0, 0],
    };
    sketch.constraints = [
      relation(),
      { id: "keep", kind: "fixed", point: "c", x: 20, y: 2 },
    ];
    expect(parseSketch(serializeSketch(sketch))).toEqual(sketch);
    const next = removeSketchGeometry(sketch, "segment", "first");
    expect(next.constraints.map((c) => c.id)).toEqual(["keep"]);
  });
});

function fixture() {
  const state: WorkspaceSnapshot = {
    name: "Collinear",
    entities: [],
    history: [],
    future: [],
    selectedId: null,
    selection: null,
    settings: {},
    authoring: { sketch: fix(source()) },
  };
  const setSketch = vi.fn((next: Sketch) => {
    state.authoring = { ...state.authoring, sketch: next };
  });
  const host: WorkspaceHost = {
    snapshot: () => ({ ...state }),
    cad: () => ({}) as CadClient,
    commit: vi.fn(),
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch,
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
  };
  return {
    state,
    host,
    setSketch,
    api: new ApplicationApi(host, createOperations(host)),
  };
}

it("discovers collinear through sketch_set and solves once through its public MCP contract", async () => {
  const { api, state, host, setSketch } = fixture();
  try {
    expect(
      JSON.stringify(await api.invoke("tools_search", { query: "collinear" })),
    ).toContain("sketch_set");
    const request = {
      sketch: {
        ...state.authoring.sketch!,
        constraints: [...state.authoring.sketch!.constraints, relation()],
      },
      solve: true,
      expectedRevision: api.currentRevision(),
      requestId: "collinear",
    };
    const reply = await api.invoke("sketch_set", request);
    expect(reply).toMatchObject({
      ok: true,
      result: {
        updated: true,
        solution: { converged: true, degreesOfFreedom: 2 },
      },
    });
    expect(
      distances(state.authoring.sketch!).every((d) => Math.abs(d) < 2e-6),
    ).toBe(true);
    expect(await api.invoke("sketch_set", request)).toEqual(reply);
    expect(setSketch).toHaveBeenCalledOnce();
    expect(host.commit).not.toHaveBeenCalled();
    expect(JSON.stringify(await api.invoke("sketch_get", {}))).toContain(
      '"collinear"',
    );
    expect(
      await api.invoke("sketch_set", { ...request, requestId: "stale" }),
    ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  } finally {
    api.dispose();
  }
});

it("rejects conflicts and degenerate raw drafts atomically through MCP", async () => {
  const { api, state, setSketch } = fixture();
  try {
    const before = structuredClone(state),
      revision = api.currentRevision();
    const conflict = fix(source(), ["a", "b", "c", "d"]);
    conflict.constraints.push(relation());
    expect(
      await api.invoke("sketch_set", {
        sketch: conflict,
        solve: true,
        expectedRevision: revision,
        requestId: "conflict",
      }),
    ).toMatchObject({ ok: false });
    const invalid = source();
    Object.assign(invalid.points[1], { x: 0, y: 0 });
    invalid.constraints.push(relation());
    expect(
      await api.invoke("sketch_set", {
        sketch: invalid,
        solve: false,
        expectedRevision: revision,
        requestId: "invalid",
      }),
    ).toMatchObject({ ok: false });
    expect(state).toEqual(before);
    expect(api.currentRevision()).toBe(revision);
    expect(setSketch).not.toHaveBeenCalled();
  } finally {
    api.dispose();
  }
});
