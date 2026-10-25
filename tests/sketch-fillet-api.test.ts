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

const rectangle = (): Sketch => ({
  version: 1,
  points: [
    { id: "p0", x: 0, y: 0 },
    { id: "p1", x: 10, y: 0 },
    { id: "p2", x: 10, y: 10 },
    { id: "p3", x: 0, y: 10 },
  ],
  segments: [
    { id: "bottom", a: "p0", b: "p1" },
    { id: "right", a: "p1", b: "p2" },
    { id: "top", a: "p2", b: "p3" },
    { id: "left", a: "p3", b: "p0" },
  ],
  constraints: [],
});
const selection = {
  first: "bottom",
  second: "right",
  firstEnd: "b",
  secondEnd: "a",
  radiusMm: 2,
};
function fixture(sketch = rectangle()) {
  const state: WorkspaceSnapshot = {
    name: "Fillet",
    entities: [],
    history: [],
    future: [],
    authoring: { sketch },
    selectedId: null,
    selection: null,
    settings: {},
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
    api: new ApplicationApi(host, createOperations(host)),
    state,
    setSketch,
    host,
  };
}

it("discovers fixed-radius sketch fillets and publishes one analytic edit with retry protection", async () => {
  const { api, state, setSketch, host } = fixture();
  try {
    expect(
      JSON.stringify(
        await api.invoke("tools_search", { query: "sketch fillet" }),
      ),
    ).toContain("sketch_corner_fillet");
    const request = {
      ...selection,
      expectedRevision: api.currentRevision(),
      requestId: "fillet",
    };
    const result = await api.invoke("sketch_corner_fillet", request);
    expect(result).toMatchObject({
      ok: true,
      result: { changed: true, intersection: [10, 0], radiusMm: 2 },
    });
    if (!result.ok) throw Error(result.error.message);
    const output = result.result as {
      center: number[];
      tangentPoints: number[][];
      arcId: string;
    };
    expect(output.center[0]).toBeCloseTo(8, 10);
    expect(output.center[1]).toBeCloseTo(2, 10);
    expect(output.tangentPoints[0][0]).toBeCloseTo(8, 10);
    expect(output.tangentPoints[0][1]).toBeCloseTo(0, 10);
    expect(output.tangentPoints[1][0]).toBeCloseTo(10, 10);
    expect(output.tangentPoints[1][1]).toBeCloseTo(2, 10);
    const sketch = state.authoring.sketch!;
    const arc = sketch.arcs!.find((a) => a.id === output.arcId)!;
    expect(arc).toBeDefined();
    expect(arc.clockwise).toBe(false);
    expect(arc.a).toBe(sketch.segments[0].b);
    expect(arc.b).toBe(sketch.segments[1].a);
    expect(arc.a).not.toBe(arc.b);
    expect(sketch.segments.slice(2)).toEqual(rectangle().segments.slice(2));
    expect(await api.invoke("sketch_corner_fillet", request)).toEqual(result);
    expect(setSketch).toHaveBeenCalledOnce();
    expect(host.commit).not.toHaveBeenCalled();
    expect(state.history).toEqual([]);
    expect(
      await api.invoke("sketch_corner_fillet", {
        ...request,
        requestId: "stale",
      }),
    ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  } finally {
    api.dispose();
  }
});

it("rejects affected constraints atomically and identifies the relation", async () => {
  const source = rectangle();
  source.constraints.push({
    id: "keep-bottom",
    kind: "horizontal",
    segment: "bottom",
  });
  const { api, state, setSketch } = fixture(source);
  try {
    const before = structuredClone(state),
      revision = api.currentRevision();
    const result = await api.invoke("sketch_corner_fillet", {
      ...selection,
      expectedRevision: revision,
      requestId: "blocked",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("keep-bottom");
    expect(state).toEqual(before);
    expect(api.currentRevision()).toBe(revision);
    expect(setSketch).not.toHaveBeenCalled();
  } finally {
    api.dispose();
  }
});

it("validates fillet radius, endpoint choices and additional fields before publication", async () => {
  const { api, state, setSketch } = fixture();
  try {
    const before = structuredClone(state),
      revision = api.currentRevision();
    const invalid = [
      { radiusMm: 0 },
      { radiusMm: -1 },
      { radiusMm: 1e9 + 1 },
      { radiusMm: Number.NaN },
      { firstEnd: "center" },
      { automaticRadius: true },
    ];
    for (const [i, fields] of invalid.entries()) {
      const result = await api.invoke("sketch_corner_fillet", {
        ...selection,
        ...fields,
        expectedRevision: revision,
        requestId: "invalid-" + i,
      });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "INVALID_ARGUMENT" },
      });
    }
    expect(state).toEqual(before);
    expect(api.currentRevision()).toBe(revision);
    expect(setSketch).not.toHaveBeenCalled();
  } finally {
    api.dispose();
  }
});

it("exposes a radius in millimetres and a distinct shared fillet action beside corner joining", () => {
  const html = renderToStaticMarkup(
    createElement(SketchTools, { value: rectangle(), onExtrude: () => {} }),
  );
  expect(html).toContain("Join corner");
  expect(html).toContain("Fillet radius (mm)");
  expect(html).toContain("Create fillet");
});
