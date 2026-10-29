import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const root = new URL(
  "./fixtures/m2-native-cyclic-split-20261029/",
  import.meta.url,
);
const load = (name: string, sha256: string) => {
  const bytes = readFileSync(new URL(name, root));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
  return parseMesh(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "stl",
  );
};
const facets = (p: ArrayLike<number>) => {
  const result: string[] = [];
  for (let i = 0; i < p.length; i += 9)
    result.push(
      [0, 3, 6]
        .map((d) => [0, 1, 2].map((a) => Math.fround(p[i + d + a])).join(","))
        .sort()
        .join("|"),
    );
  return result.sort();
};
const originalSha =
  "6e08cdde5035399ed82c103a4fbd9a973846a1f824f3e77ad5792f8d2bfb7b15";
const cyclicSha =
  "f815bf0459131a4ecc665f3bf45b282bff3d9cc9ceccc779affd904b748e4aa9";
it("uses identical source faces with only a cyclic vertex rotation", () => {
  const original = load(
    "square-source.stl",
    "2202c3e08785be8c7694ea4e72aefb7cd3f29460e17435410b1aa7d844d66d19",
  );
  const cyclic = load(
    "square-source-cyclic.stl",
    "683913baca0fe49e7d1ac803030896bcf65d6da418704e9c129084cd323c5a09",
  );
  expect(original.length).toBe(cyclic.length);
  for (let i = 0; i < original.length; i += 9) {
    expect(Array.from(cyclic.slice(i, i + 9))).toEqual([
      ...original.slice(i + 3, i + 9),
      ...original.slice(i, i + 3),
    ]);
  }
});
it("retains the observed native sensitivity to cyclic source vertex order", () => {
  const original = facets(
    load("native-convex-result-20261029.stl", originalSha),
  );
  const cyclic = facets(
    load("native-convex-cyclic-result-20261029.stl", cyclicSha),
  );
  expect(original).toHaveLength(18);
  expect(cyclic).toHaveLength(18);
  expect(original.filter((face) => cyclic.includes(face))).toHaveLength(15);
});
it.fails("matches native Split for a cyclic source vertex order", () => {
  const source = load(
    "square-source-cyclic.stl",
    "683913baca0fe49e7d1ac803030896bcf65d6da418704e9c129084cd323c5a09",
  );
  const target = load(
    "convex-cutter.stl",
    "30994066b6e33d4d479c894405ffcec5e2350d4e42c89ade4e948a2443823612",
  );
  const expected = facets(
    load("native-convex-cyclic-result-20261029.stl", cyclicSha),
  );
  const actual = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target,
  });
  expect(facets(actual.positions!)).toEqual(expected);
});
