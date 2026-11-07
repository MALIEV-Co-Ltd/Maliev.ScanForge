import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

function load(directory: string, name: string, hash: string) {
  const bytes = readFileSync(
    new URL(`./fixtures/${directory}/${name}`, import.meta.url),
  );
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
  return parseMesh(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "stl",
  );
}
function facets(p: ArrayLike<number>) {
  const out: string[] = [];
  for (let i = 0; i < p.length; i += 9)
    out.push(
      [0, 3, 6]
        .map((j) => [0, 1, 2].map((k) => Math.fround(p[i + j + k])).join(","))
        .sort()
        .join("|"),
    );
  return out.sort();
}
// Sum the union of output edges lying on the cutter intersection, as a fraction
// of the full segment. The portion outside the source triangle is not expected.
function coverage(mesh: ArrayLike<number>, a: number[], b: number[]) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = Math.hypot(dx, dy),
    intervals: number[][] = [];
  for (let i = 0; i < mesh.length; i += 9)
    for (let j = 0; j < 3; j++) {
      const u = i + 3 * j,
        v = i + 3 * ((j + 1) % 3);
      const distance = (k: number) =>
        Math.abs(dx * (mesh[k + 1] - a[1]) - dy * (mesh[k] - a[0])) / length;
      if (distance(u) > 1e-6 || distance(v) > 1e-6) continue;
      const t = (k: number) =>
        ((mesh[k] - a[0]) * dx + (mesh[k + 1] - a[1]) * dy) / (length * length);
      const lo = Math.max(0, Math.min(t(u), t(v))),
        hi = Math.min(1, Math.max(t(u), t(v)));
      if (hi - lo > 1e-7) intervals.push([lo, hi]);
    }
  intervals.sort((x, y) => x[0] - y[0]);
  const merged: number[][] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1] + 1e-6 / length)
      previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged.reduce((sum, v) => sum + v[1] - v[0], 0);
}
it("compares the isolated native cutter with the combined cutter result", () => {
  const dir = "m2-single-segment-native-20261107";
  const source = load(
    dir,
    "source.stl",
    "c067e2f6a518d7ddb475b5726e9217ff852f194ef552b864d9a8dc8f9e5491f4",
  );
  const cutter = load(
    dir,
    "cutter.stl",
    "588335ddb0394eec6b16166b3a0e98d8b6b8952bd7566747034e58c525b2bbd3",
  );
  const native = load(
    dir,
    "native-result.stl",
    "e6a7ed893a5c01a8ca2ab75e0892ae462ebba04cb8c8cbd8714b0f477a4ca50b",
  );
  const combined = load(
    "m2-crossing-pivot-native-20261107",
    "native-result.stl",
    "a4bd38115e18d5d5a8a9095f13c80dff68b795441666302e274beadb0c2522ce",
  );
  const combinedCutter = load(
    "m2-crossing-pivot-native-20261107",
    "cutter.stl",
    "9e875f7c77a1a610c9974af356e2aa09a6c8cb4d779016782107096e3d9d31c8",
  );
  expect(Array.from(cutter)).toEqual(Array.from(combinedCutter.slice(9, 18)));
  const app = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target: cutter,
  }).positions!;
  expect(native).toHaveLength(4 * 9);
  expect(facets(app)).toEqual(facets(native));
  const points: number[][] = [];
  for (let j = 0; j < 3; j++) {
    const u = 3 * j,
      v = 3 * ((j + 1) % 3),
      z = cutter[u + 2],
      zz = cutter[v + 2];
    if (z * zz < 0) {
      const t = -z / (zz - z);
      points.push([
        cutter[u] + t * (cutter[v] - cutter[u]),
        cutter[u + 1] + t * (cutter[v + 1] - cutter[u + 1]),
      ]);
    }
  }
  expect(points).toHaveLength(2);
  expect(coverage(native, points[0], points[1])).toBeCloseTo(0.981078, 5);
  expect(coverage(app, points[0], points[1])).toBeCloseTo(0.981078, 5);
  expect(coverage(combined, points[0], points[1])).toBe(0);
});
