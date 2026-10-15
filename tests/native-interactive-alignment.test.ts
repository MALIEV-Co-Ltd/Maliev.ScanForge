import { expect, it } from "vitest";
import native from "./fixtures/interactive-alignment-native.json";

// Exercise the production callback math against the retained native outputs.
import { nativeInteractiveStep } from "../src/interactive-alignment-math";
function decodedStep(sample: (typeof native.cases)[number]) {
  return nativeInteractiveStep(
    sample.kind as
      | "rotatePositive"
      | "rotateNegative"
      | "translatePositive"
      | "translateNegative",
    sample.axis,
    sample.input,
    sample.unitScale,
  );
}
const bytes = (matrix: number[]) =>
  Buffer.from(new Float64Array(matrix).buffer);
const ordered = (value: bigint) =>
  value & (1n << 63n) ? ~value : value | (1n << 63n);
const distance = (a: bigint, b: bigint) => (a > b ? a - b : b - a);

it.each(native.cases.map((sample, index) => ({ ...sample, index })))(
  "retains the native control contract $index: $kind axis=$axis step=$input unit=$unitScale",
  (sample) => {
    const expected = Buffer.from(sample.matrixBits, "hex");
    expect(expected.length).toBe(96);
    expect(sample.inputFloat32).toBe(Math.fround(sample.input));
    expect(sample.applyFlag).toBe(1);
    expect(sample.dialogPreserved).toBe(true);
    const actual = bytes(decodedStep(sample));
    for (let i = 0; i < 12; i++) {
      expect(
        distance(
          ordered(actual.readBigUInt64LE(i * 8)),
          ordered(expected.readBigUInt64LE(i * 8)),
        ),
      ).toBeLessThanOrEqual(1n);
      const a = new Float32Array([actual.readDoubleLE(i * 8)]);
      const e = new Float32Array([expected.readDoubleLE(i * 8)]);
      expect(new Uint32Array(a.buffer)[0]).toBe(new Uint32Array(e.buffer)[0]);
    }
  },
);

it("keeps native double outputs intact rather than replacing six CRT sine discrepancies", () => {
  const different = native.cases.filter(
    (sample) =>
      !bytes(decodedStep(sample)).equals(Buffer.from(sample.matrixBits, "hex")),
  );
  expect(native.cases).toHaveLength(640);
  expect(different).toHaveLength(6);
  expect(
    different.every(
      (sample) => sample.kind.startsWith("rotate") && sample.input === 45,
    ),
  ).toBe(true);
  expect(native.provenance.nativeUiCapture).toBe(false);
  expect(native.provenance.geometryApplyVerified).toBe(false);
});

it("binds the native resource controls to their distinct callbacks and data offsets", () => {
  const callbacks = native.messageMap.filter(
    (row) => row.message === "0x111" && row.code === "0x0",
  );
  for (const [id, handler] of [
    [1032, "0x140549f00"],
    [1035, "0x14054a030"],
    [1033, "0x14054a170"],
    [1034, "0x14054a430"],
    [1133, "0x140549cf0"],
    [1, "0x140548a90"],
    [2, "0x140548d60"],
  ] as const)
    expect(callbacks.find((row) => row.id === id)?.handler).toBe(handler);
  expect(native.template.caption).toBe("Align Interactive");
  expect(native.template.controls.find((row) => row.id === 1133)?.label).toBe(
    "As Current View",
  );
  expect(native.bindings.cases).toHaveLength(3);
  for (const sample of native.bindings.cases) {
    expect(sample.dialogPreserved).toBe(true);
    expect(sample.events).toHaveLength(14);
    expect(
      sample.events
        .filter((event) => event.kind === "number")
        .map((event) => [event.id, event.offset, event.digits, event.limit]),
    ).toEqual([
      [4235, 0xdc8, 4, 6],
      [1049, 0xdcc, 4, 6],
    ]);
  }
});
