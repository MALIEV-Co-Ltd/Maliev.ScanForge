import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { freemem } from "node:os";
import { parsePlyTopology } from "../src/ply-topology";
import {
  nativeGlobalPrepareScene,
  type NativeGlobalNormalCell,
} from "../src/scan-native-global-scene";
const directory = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/global-fine-scene-owner-native.json", import.meta.url),
    "utf8",
  ),
);
const hash = (value: ArrayBufferView) =>
  createHash("sha256")
    .update(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
    .digest("hex");
const bits = (v: number[]) =>
  Buffer.from(new Float64Array(v).buffer).toString("hex");
const capture = (
  cell: NativeGlobalNormalCell,
  offset = 0,
  selected: number[] = [],
) => ({
  count: cell.points.length,
  flags: cell.flags,
  color: cell.color,
  normalBits: bits(cell.normal),
  idsSha256: hash(Uint32Array.from(cell.points, (id) => id + offset)),
  selected: selected.map((id) => id + offset),
});
it.skipIf(!directory)(
  "matches native scene preparation over all three full owner scans",
  () => {
    if (freemem() < 3072 * 1048576)
      throw Error(
        "Full-owner preparation requires 3072 MiB free; do not lower admission.",
      );
    const c = fixture.cases[0];
    const scans = c.sources.map(
      (
        source: {
          name: string;
          fileSha256: string;
          pointsSha256: string;
          normalsSha256: string;
        },
        i: number,
      ) => {
        const buffer = readFileSync(directory + "/" + source.name);
        expect(hash(buffer)).toBe(source.fileSha256);
        const topology = parsePlyTopology(
          buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          ),
        );
        expect(hash(topology.vertices)).toBe(source.pointsSha256);
        expect(hash(topology.normals!)).toBe(source.normalsSha256);
        return {
          id: String(i),
          geometry: { points: topology.vertices, normals: topology.normals! },
        };
      },
    );
    const clocks = scans.map(() => 0),
      start = performance.now();
    const result = nativeGlobalPrepareScene(scans, {
      clock: (source) => {
        const clock = c.results[source].clockInputs[clocks[source]++];
        if (clock === undefined) throw Error("Unexpected native clock request");
        return clock;
      },
    });
    const elapsedMs = performance.now() - start;
    expect(result.common.map((cell) => capture(cell))).toEqual(c.commonCells);
    result.sources.forEach((actual, i) => {
      const expected = c.results[i];
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
      ).toBe(expected.layoutBits);
      expect(Array.from(actual.grid.flags)).toEqual(expected.spatialFlags);
      expect(actual.sampled).toBe(expected.sampled);
      expect(clocks[i]).toBe(expected.clockInputs.length);
      expect(hash(actual.geometry.labels)).toBe(expected.labelsSha256);
    });
    writeFileSync(
      ".resources/global-fine-scene-owner-replay.json",
      JSON.stringify(
        {
          elapsedMs,
          vertices: scans.reduce(
            (n: number, s: (typeof scans)[number]) =>
              n + s.geometry.points.length / 3,
            0,
          ),
          sampled: result.sources.map((s) => s.sampled),
          allBytesMatched: true,
        },
        null,
        2,
      ),
    );
  },
  90000,
);
