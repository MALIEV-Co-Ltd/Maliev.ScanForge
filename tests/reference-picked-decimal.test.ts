import { expect, it } from "vitest";
import { roundTripNativePickedCoordinate } from "../src/reference-pick-coordinates";
import goldens from "./fixtures/reference-picked-decimal-goldens.json";

function fromBits(bits: string): number {
  const bytes = Uint8Array.from(bits.match(/../g)!, (byte) =>
    parseInt(byte, 16),
  );
  return new DataView(bytes.buffer).getFloat64(0, true);
}
function bits(value: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, true);
  return Array.from(new Uint8Array(view.buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

// Independent Python Decimal goldens verify the arithmetic contract. Native R10
// QSF and R11 observed positive tie are separate evidence, not all-case oracles.
it.each(goldens.cases)("picked decimal roundtrip: $name", (row) => {
  expect(bits(roundTripNativePickedCoordinate(fromBits(row.inputBitsLE)))).toBe(
    row.candidates["legacy-away"].outputBitsLE,
  );
});

it.each([NaN, Infinity, -Infinity, 1e9 + 1, -1e9 - 1, null, "1", undefined])(
  "rejects invalid coordinate %s",
  (value) => {
    expect(() =>
      Reflect.apply(roundTripNativePickedCoordinate, undefined, [value]),
    ).toThrow(/finite/);
  },
);
