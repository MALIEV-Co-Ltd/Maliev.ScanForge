import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

it("preserves the enlarged source in the scaled radius control", () => {
  const root = "tests/fixtures/m2-native-radius-scale-20261029/";
  const load = (name: string, hash: string) => {
    const b = readFileSync(root + name);
    expect(createHash("sha256").update(b).digest("hex")).toBe(hash);
    return parseMesh(
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      "stl",
    );
  };
  const source = load(
    "scaled-source-triangle.stl",
    "801dceabede6cb79df0d9bc0c9855edc5b1131fabe3e56ff7c746b6c6bbaa04e",
  );
  const target = load(
    "scaled-cutter-above.stl",
    "13f6e668866e0585394359d2dc2bb86ac1bdce9e1c89ceac13db7ef4c1a1d7ee",
  );
  expect([...source]).toEqual([0, 0, 0, 10, 0, 0, 0, 10, 0]);
  const beforeSource = source.slice(),
    beforeTarget = target.slice();
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target,
  });
  expect(result.positions).toBeDefined();
  let twiceArea = 0;
  const p = result.positions!;
  expect(p.every(Number.isFinite)).toBe(true);
  for (let i = 0; i < p.length; i += 9) {
    const a =
      (p[i + 3] - p[i]) * (p[i + 7] - p[i + 1]) -
      (p[i + 4] - p[i + 1]) * (p[i + 6] - p[i]);
    expect(a).toBeGreaterThan(0);
    twiceArea += a;
  }
  expect(twiceArea / 2).toBeCloseTo(50, 10);
  expect(source).toEqual(beforeSource);
  expect(target).toEqual(beforeTarget);
});
