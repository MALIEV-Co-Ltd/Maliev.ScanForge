import { expect, it } from "vitest";
import fixture from "./fixtures/global-fine-mesh-target-pipeline-native.json";
import { prepareNativeGlobalMeshTargetSet } from "../src/scan-native-global-mesh-target";
const maximum = Math.fround(3.4028234663852886e38);
const bits = (v: readonly number[]) =>
  Buffer.from(Float64Array.from(v).buffer).toString("hex");
it.each(fixture.cases)(
  "matches complete original mesh-target query: $name",
  (c) => {
    const inputs = c.meshes.map((m) => ({
      vertices: Float32Array.from(m.vertices),
      triangles: Uint32Array.from(m.triangles),
      flags: "flags" in m ? Uint8Array.from(m.flags) : undefined,
      filterHidden: "filterHidden" in m ? m.filterHidden : false,
    }));
    const set = prepareNativeGlobalMeshTargetSet(inputs);
    const raw = c.raw
      ? {
          ...c.raw,
          point: c.raw.point.map(Math.fround),
          normal: c.raw.normal.map(Math.fround),
        }
      : undefined;
    for (let repeat = 0; repeat < 2; repeat++) {
      const result = set.query(c.point, c.radius, raw);
      expect(bits(result?.point ?? [maximum, 0, 0])).toBe(c.outputBits);
      expect(bits(result?.normal ?? [91, 92, 93])).toBe(c.normalBits);
    }
    const again = prepareNativeGlobalMeshTargetSet(inputs);
    expect(again.targets).toEqual(set.targets);
    for (let i = 0; i < inputs.length; i++)
      expect(again.targets[i]).toBe(set.targets[i]);
  },
);
it("keeps independent target radii and stable first-hit ties", () => {
  const mesh = {
    vertices: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
    triangles: Uint32Array.of(0, 1, 2),
  };
  const set = prepareNativeGlobalMeshTargetSet([mesh, { ...mesh }]);
  const result = set.query([0.25, 0.25, 0.1], 5);
  expect(result).toBe(set.targets[0].query([0.25, 0.25, 0.1], 5));
  expect(set.query([0.25, 0.25, 0.1], 0.05)).toBeUndefined();
  expect(
    prepareNativeGlobalMeshTargetSet([]).query([0, 0, 0], 5),
  ).toBeUndefined();
});
