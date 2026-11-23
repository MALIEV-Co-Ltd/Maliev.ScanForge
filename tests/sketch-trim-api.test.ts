import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { CadClient } from "../src/cad/client";
import type { Sketch } from "../src/sketch";
import { SketchTools } from "../src/ui/SketchTools";
import { trimSketchStroke } from "../src/sketch-trim";
import { SketchUndo } from "../src/sketch-undo";
import { encodeProjectFile, decodeProjectFile } from "../src/project-file";
import { sketchCurveProfile } from "../src/sketch";

function fixture() {
  const sketch: Sketch = {
    version: 1,
    points: [
      { id: "a", x: -2, y: 0 },
      { id: "b", x: 2, y: 0 },
      { id: "c", x: 0, y: -2 },
      { id: "d", x: 0, y: 2 },
    ],
    segments: [
      { id: "horizontal", a: "a", b: "b" },
      { id: "vertical", a: "c", b: "d" },
    ],
    constraints: [],
  };
  const state: WorkspaceSnapshot = {
    name: "Trim",
    entities: [],
    history: [],
    future: [],
    authoring: { sketch },
    selectedId: null,
    selection: null,
    settings: {},
  };
  const sketchHistory = new SketchUndo();
  const setSketch = vi.fn((next: Sketch) => {
    sketchHistory.record(state.authoring.sketch!, next);
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
    stepSketchHistory: (repeat) => {
      const next = repeat
        ? sketchHistory.redo(state.authoring.sketch!)
        : sketchHistory.undo(state.authoring.sketch!);
      if (!next) return false;
      state.authoring = { ...state.authoring, sketch: next };
      return true;
    },
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
  };
  return {
    state,
    setSketch,
    api: new ApplicationApi(host, createOperations(host)),
  };
}
const trim = { stroke: [[-1, 0]], radiusMm: 0.025 };

it("exposes ordinary arc-to-line trim through the shared MCP operation and sketch_get", async () => {
  const { api, state, setSketch } = fixture();
  const angle = 0.002,
    cut = angle / 2;
  const sketch: Sketch = {
    version: 1,
    points: [
      { id: "center", x: 0, y: 0 },
      { id: "start", x: 1000, y: 0 },
      { id: "end", x: 1000 * Math.cos(angle), y: 1000 * Math.sin(angle) },
      { id: "ca", x: 999 * Math.cos(cut), y: 999 * Math.sin(cut) },
      { id: "cb", x: 1001 * Math.cos(cut), y: 1001 * Math.sin(cut) },
    ],
    segments: [{ id: "cutter", a: "ca", b: "cb" }],
    arcs: [
      { id: "arc", a: "start", b: "end", center: "center", clockwise: false },
    ],
    constraints: [],
  };
  state.authoring.sketch = sketch;
  const args = {
    stroke: [[1000 * Math.cos(0.0015), 1000 * Math.sin(0.0015)]] as [
      number,
      number,
    ][],
    radiusMm: 0.01,
  };
  try {
    const preview = await trimSketchStroke(sketch, args);
    const request = {
      ...args,
      requestId: "arc-line",
      expectedRevision: api.currentRevision(),
    };
    const reply = await api.invoke("sketch_trim_stroke", request);
    expect(reply).toMatchObject({
      ok: true,
      result: { changed: true, retainedCurveIds: ["arc"] },
    });
    expect(state.authoring.sketch).toEqual(preview.sketch);
    expect(state.authoring.sketch!.arcs).toEqual([]);
    expect(
      state.authoring.sketch!.segments.find((c) => c.id === "arc"),
    ).toEqual({ id: "arc", a: "start", b: expect.any(String) });
    expect(await api.invoke("sketch_get", {})).toMatchObject({
      ok: true,
      result: { sketch: preview.sketch },
    });
    expect(await api.invoke("sketch_trim_stroke", request)).toEqual(reply);
    expect(setSketch).toHaveBeenCalledOnce();
    for (const [command, expected] of [
      ["history_undo", sketch],
      ["history_redo", preview.sketch],
    ] as const) {
      expect(
        await api.invoke(command, {
          scope: "sketch",
          expectedRevision: api.currentRevision(),
          requestId: command,
        }),
      ).toMatchObject({ ok: true, result: { updated: true, scope: "sketch" } });
      expect(state.authoring.sketch).toEqual(expected);
      expect(await api.invoke("sketch_get", {})).toMatchObject({
        ok: true,
        result: { sketch: expected },
      });
    }
    expect(state.history).toEqual([]);
    const restored = await decodeProjectFile(
      await encodeProjectFile({
        project: {
          format: "maliev-scanforge",
          version: 1,
          units: "mm",
          name: "Converted trim",
          entities: [],
          authoring: { sketch: state.authoring.sketch },
        },
        history: [],
        future: [],
      }),
    );
    expect(restored.project.authoring!.sketch).toEqual(preview.sketch);
    const segment = restored.project.authoring!.sketch!.segments.find(
      (c) => c.id === "arc",
    )!;
    const profile = sketchCurveProfile({
      ...restored.project.authoring!.sketch!,
      points: [
        ...restored.project.authoring!.sketch!.points,
        { id: "corner", x: 999, y: -1 },
      ],
      segments: [
        segment,
        { id: "close-a", a: segment.b, b: "corner" },
        { id: "close-b", a: "corner", b: segment.a },
      ],
    });
    expect(profile).toHaveLength(3);
    expect(profile.every((edge) => edge.kind === "line")).toBe(true);
  } finally {
    api.dispose();
  }
});

it("offers paint trim with an explicit millimetre radius in the shared sketch toolbar", () => {
  const html = renderToStaticMarkup(
    createElement(SketchTools, {
      drawingTool: "trim",
      onDrawingTool: vi.fn(),
      trimRadiusMm: 0.25,
      onTrimRadiusMm: vi.fn(),
      onExtrude: vi.fn(),
    }),
  );
  expect(html).toMatch(/aria-pressed="true"[^>]*>Paint trim<\/button>/);
  expect(html).toContain("Trim radius (mm)");
  expect(html).toContain('value="0.25"');
  expect(html).toContain("intersections");
});

it("discovers paint trim and commits one shared draft edit with retry and revision guards", async () => {
  const { api, state, setSketch } = fixture();
  try {
    expect(
      JSON.stringify(
        await api.invoke("tools_search", { query: "sketch trim stroke" }),
      ),
    ).toContain("sketch_trim_stroke");
    const request = {
      ...trim,
      expectedRevision: api.currentRevision(),
      requestId: "paint",
    };
    const result = await api.invoke("sketch_trim_stroke", request);
    expect(result).toMatchObject({
      ok: true,
      result: { changed: true, intersectionCount: 1 },
    });
    const s = state.authoring.sketch!;
    const point = (id: string) => s.points.find((p) => p.id === id)!;
    expect(
      s.segments.map((l) => [
        point(l.a).x,
        point(l.a).y,
        point(l.b).x,
        point(l.b).y,
      ]),
    ).toEqual([
      [0, 0, 2, 0],
      [0, -2, 0, 2],
    ]);
    expect(setSketch).toHaveBeenCalledOnce();
    expect(await api.invoke("sketch_trim_stroke", request)).toEqual(result);
    expect(setSketch).toHaveBeenCalledOnce();
    expect(
      await api.invoke("sketch_trim_stroke", {
        ...request,
        requestId: "stale",
      }),
    ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
    expect(state.history).toEqual([]);
  } finally {
    api.dispose();
  }
});

it("keeps no-hit strokes and dependency failures atomic", async () => {
  const { api, state, setSketch } = fixture();
  try {
    const revision = api.currentRevision(),
      original = structuredClone(state.authoring.sketch);
    expect(
      await api.invoke("sketch_trim_stroke", {
        stroke: [[9, 9]],
        radiusMm: 0.01,
        expectedRevision: revision,
        requestId: "miss",
      }),
    ).toMatchObject({ ok: true, result: { changed: false } });
    expect(api.currentRevision()).toBe(revision);
    expect(setSketch).not.toHaveBeenCalled();
    state.authoring.sketch = {
      ...state.authoring.sketch!,
      constraints: [
        {
          id: "horizontal-dimension",
          kind: "horizontal",
          segment: "horizontal",
        },
      ],
    };
    const constrained = structuredClone(state.authoring.sketch);
    const guardedRevision = api.currentRevision();
    expect(
      await api.invoke("sketch_trim_stroke", {
        ...trim,
        expectedRevision: guardedRevision,
        requestId: "constraint",
      }),
    ).toMatchObject({ ok: false });
    expect(state.authoring.sketch).toEqual(constrained);
    expect(api.currentRevision()).toBe(guardedRevision);
    expect(setSketch).not.toHaveBeenCalled();
    expect(original?.segments).toEqual(state.authoring.sketch?.segments);
  } finally {
    api.dispose();
  }
});

it.each([
  { stroke: [], radiusMm: 0.1 },
  { stroke: [[0, 0, 0]], radiusMm: 0.1 },
  { stroke: [[0, 0]], radiusMm: 0 },
  { stroke: [[0, 0]], radiusMm: 0.1, unexpected: true },
])("rejects malformed trim contracts without mutation %#", async (args) => {
  const { api, state, setSketch } = fixture();
  try {
    const revision = api.currentRevision(),
      before = structuredClone(state.authoring.sketch);
    expect(
      await api.invoke("sketch_trim_stroke", {
        ...args,
        expectedRevision: revision,
        requestId: "invalid",
      }),
    ).toMatchObject({ ok: false });
    expect(state.authoring.sketch).toEqual(before);
    expect(api.currentRevision()).toBe(revision);
    expect(setSketch).not.toHaveBeenCalled();
  } finally {
    api.dispose();
  }
});
