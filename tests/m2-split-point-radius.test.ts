import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

it("imports the pinned point-radius controls and preserves both Split inputs", () => {
  const folder = new URL("./fixtures/m2-split-point-radius/", import.meta.url);
  const manifest = JSON.parse(
    readFileSync(new URL("manifest.json", folder), "utf8"),
  );
  const load = (entry: { file: string; sha256: string; facets: number }) => {
    const bytes = readFileSync(new URL(entry.file, folder));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    expect(bytes.length).toBe(84 + entry.facets * 50);
    expect(bytes.readUInt32LE(80)).toBe(entry.facets);
    return parseMesh(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "stl",
    );
  };
  const source = load(manifest.source);
  expect([...source]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  for (const control of manifest.cutters) {
    const target = load(control);
    expect([...target].filter((_, index) => index % 3 === 0)).toEqual(
      Array(6).fill(control.xFloat32),
    );
    const sourceBefore = source.slice(),
      targetBefore = target.slice();
    const run = () =>
      runScanEdit({
        kind: "scanEdit",
        action: "split",
        positions: source,
        target,
      });
    const first = run(),
      second = run();
    expect(source).toEqual(sourceBefore);
    expect(target).toEqual(targetBefore);
    expect(first.diagnostics).toEqual(second.diagnostics);
    expect(first.positions).toEqual(second.positions);
    expect(first.positions?.every(Number.isFinite)).toBe(true);
    let area = 0;
    for (let i = 0; i < first.positions!.length; i += 9) {
      const p = first.positions!;
      area +=
        Math.abs(
          (p[i + 3] - p[i]) * (p[i + 7] - p[i + 1]) -
            (p[i + 4] - p[i + 1]) * (p[i + 6] - p[i]),
        ) / 2;
    }
    expect(area).toBeCloseTo(0.5, 7);
  }
  expect(manifest.cutters[0].xFloat32).toBeLessThan(
    manifest.referenceRadiusFloat32,
  );
  expect(manifest.cutters[1].xFloat32).toBe(manifest.referenceRadiusFloat32);
  expect(manifest.cutters[2].xFloat32).toBeGreaterThan(
    manifest.referenceRadiusFloat32,
  );
});
