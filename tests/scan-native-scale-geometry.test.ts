import { expect, it } from "vitest";
import { scaleScanMesh } from "../src/scan-tools-transforms";
import { runScanTool } from "../src/scan-tools";
import capture from "./fixtures/scale-geometry-native.json";

const bits = (positions: Float32Array) =>
  Array.from(new Uint8Array(positions.buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

it.each(capture.cases)(
  "preserves native Scale Mesh coordinate bits: $name, factor=$factor",
  (entry) => {
    // JSON module compilation can serialize -0 as 0. Decode the captured
    // source bytes so signed zeros survive the fixture transport too.
    const source = new Float32Array(
      Uint8Array.from(entry.inputBits.match(/../g)!, (byte) =>
        Number.parseInt(byte, 16),
      ).buffer,
    );
    const before = bits(source);
    const direct = scaleScanMesh(source, { factor: entry.factor });
    const explicitOrigin = scaleScanMesh(source, {
      factor: entry.factor,
      center: [0, 0, 0],
    });
    const dispatched = runScanTool({
      kind: "scanTools",
      positions: source,
      operation: { kind: "scaleMesh", factor: entry.factor },
    });
    expect(bits(direct.positions)).toBe(entry.nativeBits);
    expect(bits(explicitOrigin.positions)).toBe(entry.nativeBits);
    expect(bits(dispatched.positions!)).toBe(entry.nativeBits);
    expect(bits(source)).toBe(before);
  },
);
