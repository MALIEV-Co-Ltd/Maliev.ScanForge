import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initializeNativeReferenceLine } from "../src/reference-line-evaluation";
import {
  beginNumericReferenceConstructionPreview,
  disposeReferenceConstructionPreview,
} from "../src/automation/reference-construction-preview";
import type { WorkspaceHost } from "../src/automation/api";
const maxFloat = 3.4028234663852886e38;
const cleared = {
  kind: "line",
  start: [0, 0, 0],
  direction: [0, 0, 0],
  length: 0,
};
const hosts: WorkspaceHost[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const host of hosts.splice(0)) disposeReferenceConstructionPreview(host);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
function host() {
  const value = {
    snapshot: () => ({
      name: "Initialize",
      entities: [],
      history: [],
      future: [],
      authoring: {},
      settings: {},
      selectedId: null,
      selection: null,
    }),
    inspectApplication: () => ({ previews: {} }),
  } as unknown as WorkspaceHost;
  hosts.push(value);
  return value;
}
it("seeds the X segment from Float32 scene bounds and the constructor completion word", () => {
  expect(initializeNativeReferenceLine([2, -3, -4, 8, 5, 6])).toEqual({
    geometry: {
      kind: "line",
      start: [2, 0, 0],
      direction: [1, 0, 0],
      length: 6,
    },
    completionWord: 256,
  });
});
it.each([0, 1, 2])(
  "uses the 10 mm fallback for inverted bounds on axis %i",
  (axis) => {
    const bounds = [2, -3, -4, 8, 5, 6];
    bounds[axis] = bounds[axis + 3] + 1;
    expect(initializeNativeReferenceLine(bounds).geometry).toEqual({
      kind: "line",
      start: [0, 0, 0],
      direction: [1, 0, 0],
      length: 10,
    });
  },
);
it.each([0, 1, 2, 3, 4, 5])(
  "uses inclusive extreme-float sentinel rejection for bound %i",
  (index) => {
    const bounds = [2, -3, -4, 8, 5, 6];
    bounds[index] = index < 3 ? -maxFloat : maxFloat;
    expect(initializeNativeReferenceLine(bounds).geometry.length).toBe(10);
  },
);
it("does not select the fallback merely because X span is zero", () => {
  expect(initializeNativeReferenceLine([7, -3, -4, 7, 5, 6])).toEqual({
    geometry: cleared,
    completionWord: 256,
  });
});
it("uses the strict endpoint setter threshold after the bounds branch", () => {
  expect(
    initializeNativeReferenceLine([0, 0, 0, Number.EPSILON, 1, 1]).geometry,
  ).toEqual(cleared);
  expect(
    initializeNativeReferenceLine([0, 0, 0, Number.EPSILON * 2, 1, 1]).geometry
      .length,
  ).toBe(Number.EPSILON * 2);
});
it("rounds the six incoming bound carriers to Float32 before comparison and seeding", () => {
  expect(
    initializeNativeReferenceLine([16777217, 0, 0, 16777218, 1, 1]).geometry,
  ).toMatchObject({ start: [16777216, 0, 0], length: 2 });
  const state = initializeNativeReferenceLine([
    -Number.MIN_VALUE,
    0,
    0,
    Number.MIN_VALUE,
    1,
    1,
  ]);
  expect(state.geometry).toEqual(cleared);
  expect(Object.is(state.geometry.start[0], -0)).toBe(false);
});
it.each(
  [
    [0, 0, 0],
    [0, 0, 0, Infinity, 1, 1],
    [0, 0, 0, NaN, 1, 1],
    [0, 0, 0, Number.MAX_VALUE, 1, 1],
  ].map((bounds) => ({ bounds })),
)(
  "rejects malformed or non-finite bound carriers without selecting a plausible fallback",
  ({ bounds }) => {
    expect(() => initializeNativeReferenceLine(bounds)).toThrow();
  },
);
it("begins new numeric points from explicit coordinates with the native constructor word", () => {
  const state = beginNumericReferenceConstructionPreview(
    host(),
    { show: vi.fn(), clear: vi.fn() },
    {
      version: 1,
      kind: "point",
      mode: "coordinates",
      position: [-0, 2, 3],
      sources: [],
    },
  );
  expect(state.preview.geometry).toEqual({
    kind: "point",
    position: [-0, 2, 3],
  });
  expect(state.preview.state.completionWord).toBe(256);
});
it("preserves the command seed when the first typed endpoint candidate is rejected", () => {
  const state = beginNumericReferenceConstructionPreview(
    host(),
    { show: vi.fn(), clear: vi.fn() },
    {
      version: 1,
      kind: "line",
      mode: "endpoints",
      start: [4, 5, 6],
      end: [4, 5, 6],
      sources: [],
      records: [],
    },
    [2, -3, -4, 8, 5, 6],
  );
  expect(state.preview.geometry).toEqual({
    kind: "line",
    start: [2, 0, 0],
    direction: [1, 0, 0],
    length: 6,
  });
  expect(state.preview.state.completionWord).toBe(256);
});
it("overwrites the command seed with valid typed endpoint geometry", () => {
  const state = beginNumericReferenceConstructionPreview(
    host(),
    { show: vi.fn(), clear: vi.fn() },
    {
      version: 1,
      kind: "line",
      mode: "endpoints",
      start: [1, 2, 3],
      end: [4, 6, 3],
      sources: [],
      records: [],
    },
    [2, -3, -4, 8, 5, 6],
  );
  expect(state.preview.geometry).toEqual({
    kind: "line",
    start: [1, 2, 3],
    direction: [3 * (1 / 5), 4 * (1 / 5), 0],
    length: 5,
  });
});
it("requires explicit bounds for new lines and rejects derived initialization", () => {
  const display = { show: vi.fn(), clear: vi.fn() };
  expect(() =>
    beginNumericReferenceConstructionPreview(host(), display, {
      version: 1,
      kind: "line",
      mode: "endpoints",
      start: [0, 0, 0],
      end: [1, 0, 0],
      sources: [],
      records: [],
    }),
  ).toThrow(/bounds/i);
  expect(() =>
    beginNumericReferenceConstructionPreview(host(), display, {
      version: 1,
      kind: "point",
      mode: "center",
      sources: [],
    }),
  ).toThrow(/numeric/i);
  expect(display.show).not.toHaveBeenCalled();
});
