import { expect, it } from "vitest";
import {
  createNumericDatumPlane,
  numericDatumFrame,
} from "../src/datum-construction";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
} from "../src/io";
import { transformPlaneFrame, validatePlaneFrame } from "../src/plane-frame";
import {
  acquireLocatedReferenceLinePick,
  resolveReferenceLineSource,
  resolveReferencePointSource,
} from "../src/reference-construction-resolver";
import type { Entity } from "../src/types";
import { datumFeatureMetadata } from "../src/scan-native-datum-primitive";
import { nativeReferenceLinePairEndpoints } from "../src/reference-line-pairs";

const plane = () =>
  createNumericDatumPlane(
    numericDatumFrame([10, 20, 30], [0, 0, 1], [0, 1, 0]),
    12,
    "p",
    "Plane",
  );

it("retains the explicitly authored plane extent through JSON string and Blob reopening", async () => {
  const source = plane();
  expect(source.planeFrame).toMatchObject({ displaySize: 12 });
  for (const text of [
    serializeProject("Plane", [source]),
    await (await serializeProjectBlob("Plane", [source])).text(),
  ]) {
    const restored = parseProject(text).entities[0];
    expect(restored.planeFrame).toEqual(source.planeFrame);
    expect(resolveReferenceLineSource(restored, "pair")).toEqual({
      kind: "plane",
      origin: [10, 20, 30],
      normal: [0, 0, 1],
      offset: -30,
      directPlaneHalfSizes: [6, 6],
      objectResolved: true,
    });
    expect(() => resolveReferenceLineSource(restored, "average")).toThrow();
  }
});

it("captures explicit local plane UV millimetres once into the retained F32 world hit", () => {
  expect(
    acquireLocatedReferenceLinePick(
      plane(),
      { entityId: "p", planeUV: [2.25, -3.5] },
      "pair",
    ),
  ).toEqual({
    entityId: "p",
    storage: "native-pick-record-f32",
    coordinates: [13.5, 22.25, 30],
  });
});

it("uses the projected unit tangent basis for accepted nonunit and oblique stored tangents", () => {
  const source = plane();
  source.planeFrame!.tangent = [0, 5, 2];
  expect(
    acquireLocatedReferenceLinePick(
      source,
      { entityId: "p", planeUV: [2.25, -3.5] },
      "pair",
    ).coordinates,
  ).toEqual([13.5, 22.25, 30]);
  source.planeFrame!.tangent = [0, 0, 5];
  expect(() => resolveReferenceLineSource(source, "pair")).toThrow(
    /parallel|tangent/i,
  );
});

it("never infers legacy plane extents from display triangles", () => {
  const source = plane();
  delete (source.planeFrame as unknown as Record<string, unknown>).displaySize;
  expect(() => resolveReferenceLineSource(source, "pair")).toThrow(
    /extent|size/i,
  );
  expect(resolveReferencePointSource(source)).toMatchObject({
    kind: "plane",
    origin: [10, 20, 30],
    offset: -30,
  });
});

it("uses the authoritative plane frame rather than obsolete fit diagnostics", () => {
  const source = plane();
  source.fit = {
    kind: "sphere",
    center: [999, 999, 999],
    axis: [1, 0, 0],
    radius: 100,
    rms: 0,
    maxError: 0,
  };
  expect(resolveReferenceLineSource(source, "pair")).toMatchObject({
    kind: "plane",
    origin: [10, 20, 30],
    directPlaneHalfSizes: [6, 6],
  });
});

it("feeds authored half sizes to the existing two-plane evaluator without deriving AABB extents", () => {
  const a = createNumericDatumPlane(
    numericDatumFrame([0, 0, 0], [0, 0, 1]),
    12,
    "a",
    "A",
  );
  const b = createNumericDatumPlane(
    numericDatumFrame([0, 0, 0], [0, 1, 0]),
    20,
    "b",
    "B",
  );
  const result = nativeReferenceLinePairEndpoints(
    [
      resolveReferenceLineSource(a, "pair"),
      resolveReferenceLineSource(b, "pair"),
    ],
    { kind: "line", start: [0, 0, 0], direction: [0, 0, 1], length: 3 },
  );
  expect(Math.hypot(...result.end.map((v, i) => v - result.start[i]))).toBe(20);
  expect(result.start.slice(1).every((v) => v === 0)).toBe(true);
  expect(result.end.slice(1).every((v) => v === 0)).toBe(true);
});

it.each([0, -1, NaN, Infinity, 2e9 + 1, "12"])(
  "rejects invalid authored displaySize %s at the project boundary",
  (displaySize) => {
    const source = plane();
    (source.planeFrame as unknown as Record<string, unknown>).displaySize =
      displaySize;
    expect(() =>
      validatePlaneFrame(source.planeFrame, source.positions, source.kind),
    ).toThrow(/plane frame/i);
    expect(() => serializeProject("Bad plane", [source])).toThrow();
  },
);

it.each(
  [
    undefined,
    [],
    [0],
    [0, 0, 0],
    [NaN, 0],
    [0, Infinity],
    [6.01, 0],
    [0, -6.01],
    new Array(2),
  ].map((planeUV) => ({ planeUV })),
)("rejects missing or out-of-extent UV $planeUV", ({ planeUV }) => {
  expect(() =>
    acquireLocatedReferenceLinePick(
      plane(),
      { entityId: "p", planeUV } as never,
      "pair",
    ),
  ).toThrow();
});

it("rejects unrelated fields and preserves the authored extent through scale and rigid placement", () => {
  expect(() =>
    acquireLocatedReferenceLinePick(
      plane(),
      { entityId: "p", planeUV: [0, 0], parameter: 0.5 } as never,
      "pair",
    ),
  ).toThrow();
  const source = plane();
  expect(
    transformPlaneFrame(source.planeFrame!, [0, 0, 0], [0, 0, 90], 2),
  ).toMatchObject({ displaySize: 24 });
  expect(
    datumFeatureMetadata(source, [1, 0, 0, 5, 0, 1, 0, 6, 0, 0, 1, 7])
      .planeFrame,
  ).toMatchObject({ displaySize: 12 });
  const legacy: Entity = {
    ...source,
    planeFrame: { center: [0, 0, 0], normal: [0, 0, 1], tangent: [1, 0, 0] },
  };
  expect(
    transformPlaneFrame(legacy.planeFrame!, [0, 0, 0], [0, 0, 90], 2),
  ).not.toHaveProperty("displaySize");
});
