import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  nativeGlobalRefineOuter,
  nativeGlobalInvertRigid,
} from "../src/scan-native-global-outer";
interface Step {
  matrixBits: string;
  mean: number;
  std: number;
  status: 0 | -1 | -2;
  converged: boolean;
  stable: boolean;
  distanceBits: string[];
}
interface Case {
  name: string;
  seed: number;
  tolerance: number;
  scans: {
    count: number;
    initialMatrixBits: string;
    initialMean: number;
    initialStd: number;
    steps: Step[];
  }[];
  passes: number;
  events: string[];
  clockInputs: number[];
  localCalls: unknown[];
  order: number[];
  states: unknown[];
  applications: unknown[];
}
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/global-fine-outer-native.json", import.meta.url),
    "utf8",
  ),
) as { cases: Case[] };
const decode = (bits: string) => {
  const b = Buffer.from(bits, "hex");
  return Array.from({ length: b.length / 8 }, (_, i) => b.readDoubleLE(i * 8));
};
const bits = (v: readonly number[]) =>
  Buffer.from(new Float64Array(v).buffer).toString("hex");
it.each(fixture.cases)(
  "matches original outer scheduling and frame dispatch: $name",
  async (c) => {
    let clocks = 0;
    const localCalls: unknown[] = [],
      events: string[] = [];
    const scans = c.scans.map((scan, i) => ({
      id: String(i),
      pointCount: scan.count,
      matrix: decode(scan.initialMatrixBits),
      mean: scan.initialMean,
      std: scan.initialStd,
    }));
    const output = await nativeGlobalRefineOuter(
      scans,
      (source, ordered, passIndex) => {
        const index = Number(source.id),
          step =
            c.scans[index].steps[
              Math.min(passIndex, c.scans[index].steps.length - 1)
            ];
        expect(ordered.some((s) => s.id === source.id)).toBe(true);
        localCalls.push({
          source: index,
          passIndex,
          inputMatrixBits: bits(source.matrix),
          inputMeanBits: bits([source.mean]),
          inputStdBits: bits([source.std]),
        });
        return {
          ...step,
          matrix: decode(step.matrixBits),
          records: step.distanceBits.map((value) => ({
            source: [0, 0, 0],
            target: [0, 0, 0],
            active: false,
            distance: decode(value)[0],
          })),
        };
      },
      {
        clock: () => {
          clocks++;
          return c.seed;
        },
        coverageTolerance: c.tolerance,
        onProgress: (pass) => events.push(pass === 0 ? "begin" : "pass"),
      },
    );
    expect(clocks).toBe(1);
    expect(output.passes).toBe(c.passes);
    expect(events).toEqual(c.events);
    expect(localCalls).toEqual(c.localCalls);
    expect(output.order.map(Number)).toEqual(c.order);
    expect(
      output.states.map((s) => ({
        matrixBits: bits(s.matrix),
        meanBits: bits([s.mean]),
        coverageBits: bits([s.std]),
        converged: s.converged,
        stable: s.stable,
      })),
    ).toEqual(c.states);
    expect(
      output.applications.map((a) => ({
        source: Number(a.id),
        matrixBits: bits(a.matrix),
      })),
    ).toEqual(c.applications);
    expect(scans.map((s) => bits(s.matrix))).toEqual(
      c.scans.map((s) => s.initialMatrixBits),
    );
  },
);
it("rejects malformed frames, duplicate IDs and invalid runtime results", async () => {
  expect(() => nativeGlobalInvertRigid([1])).toThrow();
  const scan = {
    id: "a",
    pointCount: 1,
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    mean: 0,
    std: 0,
  };
  const refine = () => ({
    matrix: scan.matrix,
    mean: 0,
    std: 0,
    status: 0 as const,
    converged: true,
    stable: true,
    records: [],
  });
  await expect(nativeGlobalRefineOuter([scan, scan], refine)).rejects.toThrow(
    /scan state/,
  );
  await expect(
    nativeGlobalRefineOuter([scan], refine, { clock: () => NaN }),
  ).rejects.toThrow(/clock seed/);
  await expect(
    nativeGlobalRefineOuter([scan], () => ({ ...refine(), matrix: [NaN] })),
  ).rejects.toThrow(/result/);
});
