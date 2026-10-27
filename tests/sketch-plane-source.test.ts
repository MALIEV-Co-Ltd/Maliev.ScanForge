import { expect, it } from "vitest";
import {
  resolveSketchPlaneSource,
  isSketchPlaneSource,
  offsetSketchPlane,
} from "../src/sketch-plane-source";
import type { Entity } from "../src/types";
const source = (): Entity => ({
  id: "p",
  name: "Plane",
  kind: "plane",
  positions: [],
  color: "#fff",
  opacity: 1,
  visible: true,
  planeFrame: { center: [4, 5, 6], normal: [0, 0, 1], tangent: [0, 2, 1] },
});
it("preserves the stored tangent direction without requiring fit metadata", () => {
  const entity = source();
  const frame = resolveSketchPlaneSource([entity], "p", 2);
  expect(frame).toEqual({
    origin: [4, 5, 8],
    u: [0, 1, 0],
    v: [-1, 0, 0],
    normal: [0, 0, 1],
  });
  expect(entity.planeFrame!.tangent).toEqual([0, 2, 1]);
});
it("supports legacy fitted planes when no stored planeFrame exists", () => {
  const entity = source();
  delete entity.planeFrame;
  entity.fit = {
    kind: "plane",
    center: [4, 5, 6],
    axis: [0, 0, 2],
    rms: 0,
    maxError: 0,
  };
  expect(resolveSketchPlaneSource([entity], "p", -2)).toEqual({
    origin: [4, 5, 4],
    u: [1, 0, 0],
    v: [0, 1, 0],
    normal: [0, 0, 1],
  });
});
it("rejects malformed stored frames rather than silently falling back to fit", () => {
  const entity = source();
  entity.planeFrame!.tangent = [0, 0, 2];
  entity.fit = {
    kind: "plane",
    center: [0, 0, 0],
    axis: [0, 0, 1],
    rms: 0,
    maxError: 0,
  };
  expect(() => resolveSketchPlaneSource([entity], "p")).toThrow(/tangent/i);
});
it.each([NaN, Infinity, -Infinity, 1e10])(
  "rejects invalid normal offset %s",
  (offset) => {
    expect(() => resolveSketchPlaneSource([source()], "p", offset)).toThrow();
  },
);
it("rejects missing, ambiguous and non-plane source identities", () => {
  const entity = source();
  expect(() => resolveSketchPlaneSource([], "p")).toThrow(/missing/i);
  expect(() => resolveSketchPlaneSource([entity, entity], "p")).toThrow(
    /ambiguous/i,
  );
  expect(() =>
    resolveSketchPlaneSource([{ ...entity, kind: "mesh" }], "p"),
  ).toThrow(/plane/i);
});
it("validates explicit custom frames and resulting offsets and returns detached arrays", () => {
  const frame = resolveSketchPlaneSource([source()], "p");
  const moved = offsetSketchPlane(frame, 3);
  expect(moved.origin).toEqual([4, 5, 9]);
  moved.u[0] = 42;
  expect(frame.u).toEqual([0, 1, 0]);
  expect(() => offsetSketchPlane({ ...frame, u: [0, 2, 0] }, 0)).toThrow(
    /orthonormal/i,
  );
  expect(() =>
    offsetSketchPlane({ ...frame, origin: [0, 0, 1e9] }, 1),
  ).toThrow();
});

it("uses named coordinate-frame XY/YZ/XZ planes with right-handed placement and signed offsets", () => {
  const source: Entity = {
    id: "frame",
    name: "Datum",
    kind: "referenceFrame",
    positions: [],
    color: "#fff",
    visible: true,
    opacity: 1,
    coordinateFrame: {
      version: 1,
      frame: {
        origin: [2, 3, 4],
        u: [0, 1, 0],
        v: [-1, 0, 0],
        normal: [0, 0, 1],
      },
      displaySize: 10,
    },
  };
  expect(isSketchPlaneSource(source)).toBe(true);
  expect(resolveSketchPlaneSource([source], "frame", 2, "XY")).toEqual({
    origin: [2, 3, 6],
    u: [0, 1, 0],
    v: [-1, 0, 0],
    normal: [0, 0, 1],
  });
  expect(resolveSketchPlaneSource([source], "frame", 2, "YZ")).toEqual({
    origin: [2, 5, 4],
    u: [-1, 0, 0],
    v: [0, 0, 1],
    normal: [0, 1, 0],
  });
  expect(resolveSketchPlaneSource([source], "frame", -2, "XZ")).toEqual({
    origin: [4, 3, 4],
    u: [0, 0, 1],
    v: [0, 1, 0],
    normal: [-1, 0, 0],
  });
  expect(source.coordinateFrame!.frame.origin).toEqual([2, 3, 4]);
  expect(() =>
    resolveSketchPlaneSource([source], "frame", 0, "invalid" as any),
  ).toThrow();
});
