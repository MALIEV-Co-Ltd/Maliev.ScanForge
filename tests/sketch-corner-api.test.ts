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

const input = (): Sketch => ({
  version: 1,
  points: [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 3, y: 0 },
    { id: "c", x: 5, y: 2 },
    { id: "d", x: 5, y: 5 },
  ],
  segments: [
    { id: "horizontal", a: "a", b: "b" },
    { id: "vertical", a: "c", b: "d" },
  ],
  constraints: [],
});
function fixture(sketch = input()) {
  const state: WorkspaceSnapshot = {
    name: "Corner",
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
  };
}
const corner = {
  first: "horizontal",
  second: "vertical",
  firstEnd: "b",
  secondEnd: "a",
};
it("discovers and applies corner trim through the guarded shared operation exactly once", async () => {
  const { api, state, setSketch } = fixture();
  try {
    const found = await api.invoke("tools_search", { query: "sketch corner" });
    expect(JSON.stringify(found)).toContain("sketch_corner_trim");
    const request = {
      ...corner,
      expectedRevision: api.currentRevision(),
      requestId: "corner",
    };
    const result = await api.invoke("sketch_corner_trim", request);
    expect(result).toMatchObject({
      ok: true,
      result: { changed: true, intersection: [5, 0], pointId: "b" },
    });
    expect(state.authoring.sketch?.segments[1].a).toBe("b");
    expect(state.authoring.sketch?.points.find((p) => p.id === "b")).toEqual({
      id: "b",
      x: 5,
      y: 0,
    });
    expect(await api.invoke("sketch_corner_trim", request)).toEqual(result);
    expect(setSketch).toHaveBeenCalledOnce();
    expect(
      await api.invoke("sketch_corner_trim", {
        ...request,
        requestId: "stale",
      }),
    ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
    const again = await api.invoke("sketch_corner_trim", {
      ...corner,
      expectedRevision: api.currentRevision(),
      requestId: "noop",
    });
    expect(again).toMatchObject({ ok: true, result: { changed: false } });
    expect(setSketch).toHaveBeenCalledOnce();
  } finally {
    api.dispose();
  }
});
it("rejects dependent constraints and invalid endpoint options without draft or revision changes", async () => {
  const source = input();
  source.constraints.push({
    id: "fixed",
    kind: "fixed",
    point: "b",
    x: 3,
    y: 0,
  });
  const { api, state, setSketch } = fixture(source);
  try {
    const revision = api.currentRevision();
    const before = structuredClone(state);
    for (const firstEnd of ["b", "invalid"]) {
      const result = await api.invoke("sketch_corner_trim", {
        ...corner,
        firstEnd,
        expectedRevision: revision,
        requestId: firstEnd,
      });
      expect(result.ok).toBe(false);
      if (!result.ok && firstEnd === "b")
        expect(result.error.message).toMatch(/constrain/i);
    }
    expect(state).toEqual(before);
    expect(api.currentRevision()).toBe(revision);
    expect(setSketch).not.toHaveBeenCalled();
  } finally {
    api.dispose();
  }
});
it("provides endpoint selection and shared corner action in the GUI", () => {
  const html = renderToStaticMarkup(
    createElement(SketchTools, { value: input(), onExtrude: () => {} }),
  );
  expect(html).toContain("Corner Trim");
  expect(html).toContain("First line end");
  expect(html).toContain("Second line end");
});
