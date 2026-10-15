import { expect, it } from "vitest";
import native from "./fixtures/interactive-alignment-native.json";

// Independent decoding of the captured callbacks. This is a verification adapter,
// not a public Interactive operation or a replacement for the native fixture.
function decodedStep(sample: (typeof native.cases)[number]) {
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  const sign = sample.kind.endsWith("Negative") ? -1 : 1;
  const step = sign * Math.abs(Math.fround(sample.input));
  if (sample.kind.startsWith("translate")) {
    const value = Math.fround(step * sample.unitScale);
    if (sample.axis >= 0 && sample.axis <= 2) {
      const p = [0, 0, 0];
      p[sample.axis] = value;
      for (let r = 0; r < 3; r++)
        m[r * 4 + 3] +=
          m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2];
    }
    return m;
  }
  const angle = step * 0.017453292519943295;
  const cosine = Math.cos(angle),
    sine = Math.sin(angle);
  if (sample.axis === 0) {
    const b = m[1],
      f = m[6],
      k = m[10];
    m[1] = b * cosine + m[2] * sine;
    m[6] = f * cosine - m[5] * sine;
    m[5] = m[5] * cosine + f * sine;
    m[10] = k * cosine - m[9] * sine;
    m[2] = m[2] * cosine - b * sine;
    m[9] = m[9] * cosine + k * sine;
  } else if (sample.axis === 1) {
    const f = m[6],
      k = m[10],
      a = m[0];
    m[6] = f * cosine + m[4] * sine;
    m[0] = a * cosine - m[2] * sine;
    m[10] = k * cosine + m[8] * sine;
    m[4] = m[4] * cosine - f * sine;
    m[2] = a * sine + m[2] * cosine;
    m[8] = m[8] * cosine - k * sine;
  } else if (sample.axis === 2 && Math.abs(angle) >= 1e-5) {
    const f = m[5],
      j = m[9],
      a = m[0];
    m[5] = f * cosine - m[4] * sine;
    m[9] = j * cosine - m[8] * sine;
    m[8] = m[8] * cosine + j * sine;
    m[0] = a * cosine + m[1] * sine;
    m[4] = m[4] * cosine + f * sine;
    m[1] = m[1] * cosine - a * sine;
  }
  return m;
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
