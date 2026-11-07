import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";

const fixture = (dir: string, file: string) =>
  readFileSync(new URL(`./fixtures/${dir}/${file}`, import.meta.url));
const original = "m2-crossing-pair-native-20261107";
const reversed = "m2-reversed-crossing-native-20261107";
function mesh(data: Buffer) {
  return Array.from(parseMesh(Uint8Array.from(data).buffer, "stl"));
}
function facets(points: number[]) {
  const result = [];
  for (let i = 0; i < points.length; i += 9) {
    result.push(
      [0, 3, 6]
        .map((j) => points.slice(i + j, i + j + 3).join(","))
        .sort()
        .join("|"),
    );
  }
  return result.sort();
}

it("pins the reversed cutter and compares the two native exports", () => {
  const cutter = fixture(reversed, "cutter.stl");
  expect(createHash("sha256").update(cutter).digest("hex")).toBe(
    "ea3e69437c395b7958cb432445a0dfe2c69a2e0a37246ecc49adb01c022776aa",
  );
  const first = mesh(fixture(original, "cutter.stl"));
  const second = mesh(cutter);
  expect(first).toHaveLength(18);
  expect(second).toEqual([...first.slice(9), ...first.slice(0, 9)]);
  const before = mesh(fixture(original, "native-result.stl"));
  const after = mesh(fixture(reversed, "native-result.stl"));
  expect(after).toHaveLength(72);
  expect(facets(after)).toEqual(facets(before));
});

it("compares captured recovery transitions for the two input orders", () => {
  function calls(file: string) {
    const trace = JSON.parse(
      readFileSync(
        new URL(`../docs/evidence/${file}`, import.meta.url),
        "utf8",
      ),
    );
    expect(trace.normalized_result.messages_truncated).toBe(false);
    return trace.normalized_result.messages
      .map((m: { payload: any }) => m.payload)
      .filter((p: { event: string }) => p.event === "recovery")
      .map(
        ({
          pair,
          before,
          after,
        }: {
          pair: string;
          before: number[][];
          after: number[][];
        }) => ({ pair, before, after }),
      );
  }
  const originalCalls = calls("m2-split-native-face-transitions-20261107.json");
  expect(originalCalls).toHaveLength(2);
  expect(calls("m2-split-native-reversed-recovery-20261107.json")).toEqual(
    originalCalls,
  );
});
