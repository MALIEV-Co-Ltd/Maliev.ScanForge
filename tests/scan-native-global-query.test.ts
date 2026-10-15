import { expect, it } from "vitest";
import fixture from "./fixtures/global-fine-correspondence-native.json";
import {
  nativeGlobalQuery,
  prepareNativeGlobalQueryGeometry,
  type NativeGlobalQueryGeometry,
} from "../src/scan-native-global-query";
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
interface Case {
  name: string;
  mode: "pooled-plane" | "target-average";
  source: number[][];
  targets: number[][][];
  radius: number;
  normals?: number[][];
  targetNormals?: number[][][];
  sourceLabelWords: number[];
  targetLabelWords: number[][];
  flags?: number[];
  targetFlags?: number[][];
  sourcePose?: number[];
  targetPoses?: number[][];
  cells?: number[][];
  gateCount?: number;
  mask?: number;
  includeSelf?: boolean;
  count: number;
  results: { id: number; numericBits: string; active: boolean }[];
}
function geometry(
  points: number[][],
  normals?: number[][],
  labels?: number[],
  flags?: number[],
): NativeGlobalQueryGeometry {
  return {
    points: Float32Array.from(points.flat()),
    normals: Float32Array.from((normals ?? points.map(() => [0, 0, 1])).flat()),
    labels: labels && Uint32Array.from(labels),
    flags: flags && Uint32Array.from(flags),
  };
}
it.each(fixture.cases as Case[])(
  "matches complete original query: $name / $mode",
  (c) => {
    const source = {
      id: "source",
      geometry: geometry(c.source, c.normals, c.sourceLabelWords, c.flags),
      matrix: c.sourcePose ?? identity,
    };
    const targets = c.targets.map((p, i) => ({
      id: `target-${i}`,
      geometry: geometry(
        p,
        c.targetNormals?.[i],
        c.targetLabelWords[i],
        c.targetFlags?.[i],
      ),
      matrix: c.targetPoses?.[i] ?? identity,
    }));
    const result = nativeGlobalQuery({
      source,
      targets: c.includeSelf ? [source, ...targets] : targets,
      cells: c.cells ?? [c.source.map((_, i) => i)],
      radius: c.radius,
      mask: c.mask,
      gateCount: c.gateCount,
      mode: c.mode,
    });
    expect(result.count).toBe(c.count);
    expect(
      result.pairs.map((p) => ({
        id: p.id,
        active: p.active,
        numericBits: Buffer.from(
          Float64Array.from([...p.source, ...p.target, p.distance]).buffer,
        ).toString("hex"),
      })),
    ).toEqual(
      c.results.map((p) => ({
        id: p.id,
        active: p.active,
        numericBits: p.numericBits,
      })),
    );
  },
);
it("reuses immutable target preparation across poses and invalidates on geometry identity", () => {
  const g = geometry(
    [
      [0, 0, 0],
      [1, 0, 0],
    ],
    undefined,
    undefined,
    [0, 1],
  );
  const prepared = prepareNativeGlobalQueryGeometry(g);
  expect(prepareNativeGlobalQueryGeometry(g)).toBe(prepared);
  expect([...prepared.ids]).toEqual([0]);
  expect(
    prepareNativeGlobalQueryGeometry({ ...g, flags: Uint32Array.from([0, 0]) }),
  ).not.toBe(prepared);
});
