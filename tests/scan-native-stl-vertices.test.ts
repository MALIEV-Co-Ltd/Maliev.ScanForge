import { describe, expect, it } from "vitest";
import {
  NativeStlVertexTable,
  nativeStlCoordinateKey,
  nativeStlVertexHash,
  nativeStlVertexBucketHash,
  type NativeStlKey,
} from "../src/scan-native-stl-vertices";
import hashCapture from "./fixtures/stl-hash-native.json";
import keyCapture from "./fixtures/stl-key-native.json";
import mapCapture from "./fixtures/stl-map-native.json";

describe("original optimized STL coordinate keys", () => {
  for (const sample of keyCapture.samples)
    it(sample.name, () => {
      for (const record of sample.records)
        expect(
          sample.point.map((p) => nativeStlCoordinateKey(p).toString()),
        ).toEqual(record.keys);
    });
});

describe("original optimized STL hash", () => {
  for (const [index, sample] of hashCapture.cases.entries())
    it(`matches native case ${index} with six masks`, () => {
      const hash = nativeStlVertexHash(
        sample.keys.map(BigInt) as unknown as NativeStlKey,
      );
      for (const bucket of sample.buckets)
        expect((hash & BigInt(bucket.mask)).toString()).toBe(bucket.result);
      const raw = sample.buckets.find(
        (bucket) => bucket.mask === "18446744073709551615",
      )!;
      expect(
        nativeStlVertexBucketHash(
          sample.keys.map(BigInt) as unknown as NativeStlKey,
        ),
      ).toBe(Number(BigInt.asUintN(32, BigInt(raw.result))));
    });
});

describe("original optimized STL vertex iteration", () => {
  for (const sample of mapCapture.samples)
    it(`matches ${sample.name} through collisions and rehashing`, () => {
      const table = new NativeStlVertexTable();
      for (const [index, stage] of sample.stages.entries()) {
        const key = stage.insertedKeys.map(BigInt) as unknown as NativeStlKey;
        const result = table.insert(key, index);
        expect(result.inserted).toBe(stage.inserted);
        expect(table.size).toBe(stage.size);
        expect(table.bucketCount).toBe(stage.bucketCount);
        if (stage.sequence)
          expect(
            Array.from(table.entries(), (entry) => ({
              keys: entry.key.map(String),
              value: entry.value,
            })),
          ).toEqual(stage.sequence);
      }
    });

  it("keeps the first vertex value and copies caller-owned keys", () => {
    const table = new NativeStlVertexTable();
    const key: [bigint, bigint, bigint] = [1n, 2n, 3n];
    table.insert(key, 17);
    key[0] = 99n;
    expect(table.insert([1n, 2n, 3n], 42)).toEqual({
      inserted: false,
      value: 17,
    });
    expect(Array.from(table.entries())).toEqual([
      { key: [1n, 2n, 3n], value: 17 },
    ]);
  });
});
