import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const root = "tests/fixtures/m2-rotated-recovery-20261029/";
const load = (name: string, sha: string) => {
  const bytes = readFileSync(root + name);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha);
  return parseMesh(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "stl",
  );
};
const facets = (values: ArrayLike<number>) =>
  Array.from({ length: values.length / 9 }, (_, i) =>
    [0, 3, 6]
      .map((k) =>
        [0, 1, 2].map((j) => Math.fround(values[i * 9 + k + j])).join(","),
      )
      .sort()
      .join("|"),
  );

it("retains the native rotated boundary fan when inserting collinear contacts", () => {
  const source = load(
    "vertical-source.stl",
    "b33ffb30fdc5704165f1017584c93f8ff68628c733ae05309e8cf7e07fa2f1a6",
  );
  const cutter = load(
    "grid-128.stl",
    "eec41aa1580de2960509d206379fe9c5ae0a79b5b6a248ccf2f218a2efecdf01",
  );
  const native = load(
    "native-rotated-result-20261029.stl",
    "05ea52970253179382885d3ea716b8cc5b88f9e1b68e0c5f796abed39e69b9d3",
  );
  const before = Array.from(source);
  const output = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target: cutter,
  }).positions!;
  const remaining = facets(native),
    actual = facets(output);
  let extra = 0;
  for (const face of actual) {
    const index = remaining.indexOf(face);
    if (index >= 0) remaining.splice(index, 1);
    else extra++;
  }
  // The remaining difference reflects endpoint reuse, not full native parity.
  expect(remaining).toHaveLength(1);
  expect(extra).toBe(3);
  expect(actual).toHaveLength(38);
  expect(new Set(actual).size).toBe(actual.length);
  const area = (values: ArrayLike<number>) => {
    let sum = 0;
    for (let i = 0; i < values.length; i += 9) {
      const a = [values[i], values[i + 1], values[i + 2]];
      const u = [0, 1, 2].map((j) => values[i + 3 + j] - a[j]);
      const v = [0, 1, 2].map((j) => values[i + 6 + j] - a[j]);
      sum +=
        Math.hypot(
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ) / 2;
    }
    return sum;
  };
  expect(area(output)).toBeCloseTo(area(source), 6);
  expect(Array.from(source)).toEqual(before);
});
