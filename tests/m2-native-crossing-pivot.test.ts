import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";
import { analyzeIndexedMesh } from "../src/mesh-processing";

const root = new URL(
  "./fixtures/m2-crossing-pivot-native-20261107/",
  import.meta.url,
);
function load(name: string, hash: string) {
  const data = readFileSync(new URL(name, root));
  expect(createHash("sha256").update(data).digest("hex")).toBe(hash);
  return parseMesh(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    "stl",
  );
}
function facets(positions: ArrayLike<number>) {
  const rows: string[] = [];
  for (let i = 0; i < positions.length; i += 9)
    rows.push(
      [0, 3, 6]
        .map((offset) =>
          [0, 1, 2]
            .map((axis) => Math.fround(positions[i + offset + axis]))
            .join(","),
        )
        .sort()
        .join("|"),
    );
  return rows.sort();
}
function area(p: ArrayLike<number>) {
  let total = 0;
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3] - p[i],
      uy = p[i + 4] - p[i + 1],
      uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i],
      vy = p[i + 7] - p[i + 1],
      vz = p[i + 8] - p[i + 2];
    total +=
      Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return total;
}
it("records the native crossing-segment Split difference while preserving source coverage", () => {
  const source = load(
    "source.stl",
    "c067e2f6a518d7ddb475b5726e9217ff852f194ef552b864d9a8dc8f9e5491f4",
  );
  const cutter = load(
    "cutter.stl",
    "9e875f7c77a1a610c9974af356e2aa09a6c8cb4d779016782107096e3d9d31c8",
  );
  const native = load(
    "native-result.stl",
    "a4bd38115e18d5d5a8a9095f13c80dff68b795441666302e274beadb0c2522ce",
  );
  const roundtrip = load(
    "native-cutter.stl",
    "0ec4196cb148e51d70a559a50589afd4fdb05e278154c8d105f44a72fab08590",
  );
  expect(facets(roundtrip)).toEqual(facets(cutter));
  const sourceBefore = source.slice(),
    cutterBefore = cutter.slice();
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target: cutter,
  });
  expect(source).toEqual(sourceBefore);
  expect(cutter).toEqual(cutterBefore);
  expect(result.positions).toHaveLength(16 * 9);
  expect(native).toHaveLength(14 * 9);
  expect(area(result.positions!)).toBeCloseTo(0.5, 7);
  expect(area(native)).toBeCloseTo(0.5, 7);
  const appFacets = facets(result.positions!),
    nativeFacets = facets(native);
  let i = 0,
    j = 0,
    shared = 0;
  while (i < appFacets.length && j < nativeFacets.length) {
    if (appFacets[i] === nativeFacets[j]) {
      shared++;
      i++;
      j++;
    } else if (appFacets[i] < nativeFacets[j]) i++;
    else j++;
  }
  expect(shared).toBe(9);
  const mesh = result.indexedMesh!;
  expect(
    analyzeIndexedMesh(
      Float64Array.from(mesh.vertices),
      Uint32Array.from(mesh.triangles),
    ).components,
  ).toHaveLength(2);
});
