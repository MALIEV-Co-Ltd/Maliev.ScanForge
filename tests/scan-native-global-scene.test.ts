import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  nativeGlobalPrepareScene,
  type NativeGlobalNormalCell,
} from "../src/scan-native-global-scene";

interface Cell {
  count: number;
  flags: number;
  color: number;
  normalBits: string;
  idsSha256: string;
  ids: number[];
  selected: number[];
}
interface Case {
  name: string;
  spacing?: number;
  radius?: number;
  budget?: number;
  mask?: number;
  scans: {
    points: number[][];
    normals: number[][];
    flags?: number[];
    labels?: number[];
  }[];
  commonCells: Cell[];
  results: {
    labels: number[];
    bounds: number[];
    dimensions: number[];
    layoutBits: string;
    spatialFlags: number[];
    clockInputs: number[];
    sampled: number;
    sourceCells: Cell[];
  }[];
}
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/global-fine-scene-native.json", import.meta.url),
    "utf8",
  ),
) as { cases: Case[] };

const bits = (values: number[]) =>
  Buffer.from(new Float64Array(values).buffer).toString("hex");
function capture(
  cell: NativeGlobalNormalCell,
  offset = 0,
  selected: number[] = [],
) {
  const ids = cell.points.map((id) => id + offset);
  return {
    count: ids.length,
    flags: cell.flags,
    color: cell.color,
    normalBits: bits(cell.normal),
    idsSha256: createHash("sha256")
      .update(Buffer.from(new Uint32Array(ids).buffer))
      .digest("hex"),
    ids,
    selected: selected.map((id) => id + offset),
  };
}
it.each(fixture.cases)(
  "matches original complete scene preparation: $name",
  (c) => {
    const scans = c.scans.map((s, i) => ({
      id: String(i),
      geometry: {
        points: Float32Array.from(s.points.flat()),
        normals: Float32Array.from(s.normals.flat()),
        flags: "flags" in s ? Uint32Array.from(s.flags as number[]) : undefined,
        labels:
          "labels" in s ? Uint32Array.from(s.labels as number[]) : undefined,
      },
    }));
    const originals = scans.map((s) => s.geometry.labels?.slice());
    const clocks = scans.map(() => 0);
    const options = c as typeof c & {
      spacing?: number;
      radius?: number;
      budget?: number;
      mask?: number;
    };
    const result = nativeGlobalPrepareScene(scans, {
      ...options,
      clock: (source) => {
        const value = c.results[source].clockInputs[clocks[source]++];
        expect(value).toBeDefined();
        return value;
      },
    });
    expect(result.common.map((cell) => capture(cell))).toEqual(c.commonCells);
    for (let i = 0; i < scans.length; i++) {
      const actual = result.sources[i],
        expected = c.results[i];
      expect(
        actual.cells.map((cell, j) =>
          capture(cell, result.offsets[i], result.selected[i][j]),
        ),
      ).toEqual(expected.sourceCells);
      expect(actual.bounds).toEqual(expected.bounds);
      expect(actual.grid.dimensions).toEqual(expected.dimensions);
      expect(
        bits([
          ...actual.grid.size,
          ...actual.grid.scale,
          ...actual.grid.origin,
        ]),
      ).toEqual(expected.layoutBits);
      expect(Array.from(actual.grid.flags)).toEqual(expected.spatialFlags);
      expect(actual.sampled).toBe(expected.sampled);
      expect(clocks[i]).toBe(expected.clockInputs.length);
      expect(Array.from(actual.geometry.labels)).toEqual(expected.labels);
      expect(scans[i].geometry.labels).toEqual(originals[i]);
      expect(actual.geometry.points).toBe(scans[i].geometry.points);
      expect(actual.geometry.normals).toBe(scans[i].geometry.normals);
    }
  },
);

it("rejects malformed geometry and excessive spatial allocations", () => {
  const valid = {
    id: "a",
    geometry: {
      points: new Float32Array([0, 0, 0]),
      normals: new Float32Array([0, 0, 1]),
    },
  };
  const clock = () => 0;
  expect(() =>
    nativeGlobalPrepareScene(
      [
        {
          ...valid,
          geometry: { ...valid.geometry, labels: new Uint32Array(2) },
        },
      ],
      { clock },
    ),
  ).toThrow();
  expect(() =>
    nativeGlobalPrepareScene(
      [
        {
          ...valid,
          geometry: { ...valid.geometry, flags: new Uint32Array(2) },
        },
      ],
      { clock },
    ),
  ).toThrow();
  expect(() =>
    nativeGlobalPrepareScene(
      [
        {
          ...valid,
          geometry: {
            ...valid.geometry,
            normals: new Float32Array([0, 0, NaN]),
          },
        },
      ],
      { clock },
    ),
  ).toThrow();
  expect(() =>
    nativeGlobalPrepareScene([valid], { clock, budget: 0 }),
  ).toThrow();
  expect(() =>
    nativeGlobalPrepareScene([valid], { clock, radius: -1 }),
  ).toThrow();
  expect(() =>
    nativeGlobalPrepareScene(
      [
        {
          id: "large",
          geometry: {
            points: new Float32Array([0, 0, 0, 1e6, 1e6, 1e6]),
            normals: new Float32Array([0, 0, 1, 0, 0, 1]),
          },
        },
      ],
      { clock, spacing: 1 },
    ),
  ).toThrow(/admission/);
});
