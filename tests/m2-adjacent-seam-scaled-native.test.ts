import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

it("compares the 1000x adjacent seam Split to its native output", () => {
  const load = (name: string, hash: string) => {
    const b = readFileSync(
      new URL(
        `./fixtures/m2-adjacent-seam-scaled-20261105/${name}`,
        import.meta.url,
      ),
    );
    expect(createHash("sha256").update(b).digest("hex")).toBe(hash);
    return parseMesh(
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      "stl",
    );
  };
  const source = load(
    "source.stl",
    "a22bfaafb76d72830b40edf646a128b02667b75217f84b4978c4b884faf838ce",
  );
  const cutter = load(
    "cutter.stl",
    "0cd38794e186f8f38883505719e17105dccbddda8357380c2f1b2b3a1f39e50c",
  );
  const roundtrip = load(
    "native-cutter-roundtrip.stl",
    "c2bf6f4e3ece4be8c76eaef7a6028b39e7e267598315700636e70eca7017820b",
  );
  expect([...roundtrip]).toEqual([...cutter]);
  const native = load(
    "native-result.stl",
    "3a28b5231d21585cc4ea9bdc062a2eb977e682f87c0c5a070a5687eb1867ea6e",
  );
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target: cutter,
  });
  const facets = (v: ArrayLike<number>) =>
    Array.from({ length: v.length / 9 }, (_, f) =>
      [0, 3, 6]
        .map((o) =>
          [0, 1, 2].map((a) => Math.fround(v[9 * f + o + a])).join(","),
        )
        .sort()
        .join("|"),
    ).sort();
  expect(result.diagnostics.parts).toBe(2);
  expect(facets(result.positions!)).toEqual(facets(native));
});
