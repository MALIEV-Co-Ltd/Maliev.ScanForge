import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

it("pins the adjacent-seam STL inputs and their shared Split control", () => {
  const load = (name: string, hash: string) => {
    const bytes = readFileSync(
      new URL(`./fixtures/m2-adjacent-seam-20261105/${name}`, import.meta.url),
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    return parseMesh(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "stl",
    );
  };
  const source = load(
    "source.stl",
    "1ccb1730b3806d6eee50ee56c1fb602ae0a377efeabbccebf9c71d05fd8049e5",
  );
  const cutter = load(
    "cutter.stl",
    "17eb1e2487abf4b70e12ef29a10aadf88217e2486efbbe5c91ca30feeb52f9cb",
  );
  const y = 1 + 2 ** -23;
  expect([...source]).toEqual([0, 1, 0, 1, 1, 0, 0, 2, 0]);
  expect([...cutter]).toEqual([
    0.5,
    y,
    -1,
    0.5,
    y,
    1,
    0.5,
    0,
    -1,
    0.5,
    y,
    1,
    0.5,
    y,
    -1,
    0.5,
    2,
    -1,
  ]);
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target: cutter,
  });
  const output = Array.from(result.positions!);
  for (const py of [1, y])
    expect(
      output.some(
        (_, i) =>
          i % 3 === 0 &&
          output[i] === 0.5 &&
          output[i + 1] === py &&
          output[i + 2] === 0,
      ),
    ).toBe(true);
  expect(result.diagnostics.parts).toBe(2);
});
