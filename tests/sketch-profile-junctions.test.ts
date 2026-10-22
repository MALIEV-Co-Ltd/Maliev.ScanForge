import { expect, it, vi } from "vitest";
import { mirrorSketch } from "../src/sketch-mirror";
import {
  rectangleSketch,
  sketchCurveProfile,
  sketchProfile,
  type Sketch,
} from "../src/sketch";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { CadClient } from "../src/cad/client";

function separateTriangle(): Sketch {
  return {
    version: 1,
    points: [
      { id: "a0", x: 0, y: 0 },
      { id: "b0", x: 3, y: 0 },
      { id: "a1", x: 3, y: 0 },
      { id: "b1", x: 0, y: 4 },
      { id: "a2", x: 0, y: 4 },
      { id: "b2", x: 0, y: 0 },
    ],
    segments: [
      { id: "s0", a: "a0", b: "b0" },
      { id: "s1", a: "a1", b: "b1" },
      { id: "s2", a: "a2", b: "b2" },
    ],
    constraints: [],
  };
}

it("assembles the mirrored open half-profile without welding the authored graph", async () => {
  const source = rectangleSketch();
  source.segments[0].construction = true;
  const { sketch } = await mirrorSketch(source, {
    axis: "s1",
    curveIds: ["s2", "s3", "s4"],
  });
  const before = structuredClone(sketch);
  const vertices = [
    [40, 0],
    [40, 30],
    [0, 30],
    [0, 0],
    [0, -30],
    [40, -30],
  ];
  const edges = sketchCurveProfile(sketch);
  expect(edges).toEqual(
    vertices.map((start, i) => ({
      kind: "line",
      start,
      end: vertices[(i + 1) % vertices.length],
    })),
  );
  expect(sketchProfile(sketch)).toEqual(vertices);
  expect(sketch).toEqual(before);
  expect(new Set(sketch.points.map((p) => p.id)).size).toBe(8);
});

it("joins exact endpoints from independently authored lines in both profile consumers", () => {
  const sketch = separateTriangle();
  const before = structuredClone(sketch);
  expect(sketchCurveProfile(sketch)).toEqual([
    { kind: "line", start: [0, 0], end: [3, 0] },
    { kind: "line", start: [3, 0], end: [0, 4] },
    { kind: "line", start: [0, 4], end: [0, 0] },
  ]);
  expect(sketchProfile(sketch)).toEqual([
    [0, 0],
    [3, 0],
    [0, 4],
  ]);
  expect(sketch).toEqual(before);
});

it("preserves analytic arcs and traversal direction when the joining point IDs differ", () => {
  const sketch: Sketch = {
    version: 1,
    points: [
      { id: "a", x: 2, y: 0 },
      { id: "b", x: -2, y: 0 },
      { id: "a2", x: 2, y: 0 },
      { id: "b2", x: -2, y: 0 },
      { id: "c", x: 0, y: 0 },
    ],
    segments: [],
    arcs: [
      { id: "upper", a: "a", b: "b", center: "c", clockwise: false },
      { id: "lower", a: "a2", b: "b2", center: "c", clockwise: true },
    ],
    constraints: [],
  };
  expect(sketchCurveProfile(sketch)).toEqual([
    {
      kind: "arc",
      start: [2, 0],
      end: [-2, 0],
      center: [0, 0],
      clockwise: false,
    },
    {
      kind: "arc",
      start: [-2, 0],
      end: [2, 0],
      center: [0, 0],
      clockwise: false,
    },
  ]);
  const polygon = sketchProfile(sketch, 0.01);
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    area += a[0] * b[1] - a[1] * b[0];
  }
  expect(area / 2).toBeGreaterThan(12.4);
});

it.each([sketchCurveProfile, sketchProfile])(
  "rejects a real gap instead of silently snapping it (%#)",
  (profile) => {
    const sketch = separateTriangle();
    sketch.points[5].y = 1e-12;
    expect(() => profile(sketch)).toThrow(/cycle|closed/);
  },
);

it.each([sketchCurveProfile, sketchProfile])(
  "rejects a branch formed by coincident endpoint aliases (%#)",
  (profile) => {
    const sketch = separateTriangle();
    sketch.points.push(
      { id: "branch-start", x: 0, y: 0 },
      { id: "branch-end", x: 1, y: 1 },
    );
    sketch.segments.push({ id: "branch", a: "branch-start", b: "branch-end" });
    expect(() => profile(sketch)).toThrow(/cycle|closed/);
  },
);

it("does not treat unused centre or construction points as extra profile branches", () => {
  const sketch = separateTriangle();
  sketch.points.push(
    { id: "unused", x: 0, y: 0 },
    { id: "reference", x: -1, y: -1 },
  );
  sketch.segments.push({
    id: "construction",
    a: "unused",
    b: "reference",
    construction: true,
  });
  expect(sketchCurveProfile(sketch)).toHaveLength(3);
});

it("treats signed zero as the same geometric endpoint without changing source bits", () => {
  const sketch = separateTriangle();
  sketch.points[5].x = -0;
  expect(sketchCurveProfile(sketch)).toHaveLength(3);
  expect(Object.is(sketch.points[5].x, -0)).toBe(true);
});

it.each(["sketch-curves", "sketch"] as const)(
  "routes coincident-ID junctions through public cad_create (%s) once",
  async (kind) => {
    const sketch = separateTriangle(),
      before = structuredClone(sketch);
    const state: WorkspaceSnapshot = {
      name: "Junctions",
      entities: [],
      history: [],
      future: [],
      authoring: {},
      selectedId: null,
      selection: null,
      settings: {},
    };
    const mesh = {
      kernelId: "junction-solid",
      brep: "exact-brep",
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    };
    const extrudeCurves = vi.fn(async () => mesh),
      extrude = vi.fn(async () => mesh);
    const cad = {
      extrudeCurves,
      extrude,
      release: vi.fn(async () => true),
    } as unknown as CadClient;
    let busy = false;
    const host: WorkspaceHost = {
      snapshot: () => ({ ...state }),
      cad: () => cad,
      commit: (entities, label) => {
        state.history = [...state.history, { entities: state.entities, label }];
        state.entities = entities;
      },
      replace: vi.fn(),
      select: vi.fn(),
      setSelection: vi.fn(),
      setSketch: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      view: vi.fn(),
      settings: vi.fn(),
      busy: () => busy,
      activity: (value) => {
        busy = value;
      },
    };
    const api = new ApplicationApi(host, createOperations(host));
    try {
      const args = {
        name: "Closed triangle",
        recipe: { kind: "extrude", profile: { kind, sketch }, height: 5 },
        expectedRevision: api.currentRevision(),
        requestId: "junction-extrusion",
      };
      const response = await api.invoke("cad_create", args);
      expect(response.ok).toBe(true);
      if (!response.ok) throw Error(response.error.message);
      const jobId = (response.result as { jobId: string }).jobId;
      let job: { status: string; error?: unknown } | undefined;
      for (let i = 0; i < 80; i++) {
        const reply = await api.invoke("job_get", { jobId });
        if (!reply.ok) throw Error(reply.error.message);
        job = reply.result as typeof job;
        if (job?.status !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(job).toMatchObject({ status: "succeeded" });
      expect(state.entities).toHaveLength(1);
      expect(state.history).toHaveLength(1);
      expect(await api.invoke("cad_create", args)).toEqual(response);
      expect(
        kind === "sketch-curves" ? extrudeCurves : extrude,
      ).toHaveBeenCalledOnce();
      expect(sketch).toEqual(before);
    } finally {
      api.dispose();
    }
  },
);
