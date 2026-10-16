import { expect, it } from "vitest";
import { createGlobalQueryWorkerState } from "../src/scan-global-query-worker";
import {
  prepareNativeGlobalQueryGeometry,
  type NativeGlobalQueryGeometry,
} from "../src/scan-native-global-query";
import fixture from "./fixtures/global-fine-mesh-correspondence-native.json";
import { meshCorrespondenceFixture } from "./helpers/global-mesh-correspondence-fixture";
type Routed = NativeGlobalQueryGeometry & { rawTargetIds?: Uint32Array };
const bits = (v: number[]) =>
  Buffer.from(Float64Array.from(v).buffer).toString("hex");

it.each(
  fixture.cases.filter((c) => c.targets.every((points) => !points.length)),
)(
  "keeps source records without raw targets and preserves native evaluator routing: $name / $mode",
  (c) => {
    const { scans, job } = meshCorrespondenceFixture(c),
      source = scans[0].geometry;
    for (const scan of scans.slice(1)) {
      Object.assign(scan.geometry, {
        points: source.points,
        normals: source.normals,
        labels: undefined,
        flags: undefined,
        rawTargetIds: new Uint32Array(),
      });
      const ready = prepareNativeGlobalQueryGeometry(scan.geometry);
      expect(scan.geometry.points.length).toBeGreaterThan(0);
      expect(ready.ids.length).toBe(0);
      expect(ready.tree.points.length).toBe(0);
    }
    const state = createGlobalQueryWorkerState({ scans });
    const result = state.execute(job);
    expect(result.count).toBe(c.count);
    expect(
      result.pairs.map((p) => ({
        id: p.id,
        active: p.active,
        numericBits: bits([...p.source, ...p.target, p.distance]),
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
it("indexes only admitted raw records while retaining original source IDs and immutable source storage", () => {
  const points = Float32Array.of(0, 0, 0, 1, 0, 0, 2, 0, 0);
  const geometry: Routed = {
    points,
    normals: new Float32Array(points.length),
    flags: Uint32Array.of(0x80000008, 1, 2),
    rawTargetIds: Uint32Array.of(0, 2),
  };
  const result = prepareNativeGlobalQueryGeometry(geometry);
  expect([...result.ids]).toEqual([0, 2]);
  expect([...result.tree.points]).toEqual([0, 0, 0, 2, 0, 0]);
  expect([...points]).toEqual([0, 0, 0, 1, 0, 0, 2, 0, 0]);
  expect(prepareNativeGlobalQueryGeometry(geometry)).toBe(result);
});
it("rejects duplicate, out-of-range, unordered or hidden raw record IDs", () => {
  for (const rawTargetIds of [
    Uint32Array.of(0, 0),
    Uint32Array.of(3),
    Uint32Array.of(2, 0),
    Uint32Array.of(1),
  ]) {
    const geometry: Routed = {
      points: new Float32Array(9),
      normals: new Float32Array(9),
      flags: Uint32Array.of(0, 1, 0),
      rawTargetIds,
    };
    expect(() => prepareNativeGlobalQueryGeometry(geometry)).toThrow(
      /raw target/i,
    );
  }
});
