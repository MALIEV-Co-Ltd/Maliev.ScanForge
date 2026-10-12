import { expect, it } from "vitest";
import capture from "./fixtures/flip-kernel-native.json";
import { runScanTool } from "../src/scan-tools";
import { flipScanNormals } from "../src/scan-tools-transforms";

function fromBits(hex: string) {
  return new Float32Array(
    Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16)).buffer,
  );
}
for (const entry of capture.cases) {
  it(`matches original Flip Normals facet output for ${entry.name}`, () => {
    const source = fromBits(entry.inputBits);
    const before = source.slice();
    const stages: string[] = [];
    const output = runScanTool(
      {
        kind: "scanTools",
        positions: source,
        operation: { kind: "flipNormals" },
      },
      { onProgress: (_, stage) => stages.push(stage) },
    ).positions;
    expect(new Uint8Array(output.buffer)).toEqual(
      new Uint8Array(fromBits(entry.nativeBits).buffer),
    );
    expect(new Uint8Array(flipScanNormals(output).positions.buffer)).toEqual(
      new Uint8Array(before.buffer),
    );
    expect(new Uint8Array(source.buffer)).toEqual(
      new Uint8Array(before.buffer),
    );
    expect(
      stages.some((stage) => /Welding|Building topology/.test(stage)),
    ).toBe(false);
    expect(entry.doubleFlipRestoresFacetBytes).toBe(true);
    expect(entry.verticesUnchanged).toBe(true);
    expect(entry.reciprocalAdjacencyValid).toBe(true);
    expect(entry.refreshModes).toEqual([0, 0]);
  });
}

it("retains source on cancellation or invalid coordinates", () => {
  const source = fromBits(capture.cases[0].inputBits);
  const before = source.slice();
  const controller = new AbortController();
  controller.abort();
  expect(() => flipScanNormals(source, { signal: controller.signal })).toThrow(
    /cancelled/,
  );
  expect(new Uint8Array(source.buffer)).toEqual(new Uint8Array(before.buffer));
  expect(() => flipScanNormals(new Float32Array(9).fill(Infinity))).toThrow(
    /finite/,
  );
});
