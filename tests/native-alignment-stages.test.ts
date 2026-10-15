import { expect, it } from "vitest";
import native from "../docs/evidence/landmark-two-stage-native.json";
import {
  transformDatumCoordinates,
  transformDatumCoordinateStages,
} from "../src/datum-transform-kernel";
import { nativeDatumIsIdentity } from "../src/scan-native-datum-apply";
function values(hex: string) {
  const bytes = Uint8Array.from(hex.match(/../g)!, (value) =>
    parseInt(value, 16),
  );
  return new Float32Array(bytes.buffer);
}
function bits(values: Float32Array) {
  return Array.from(new Uint8Array(values.buffer), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
it.each(native.cases.map((capture, index) => ({ ...capture, index })))(
  "matches original two-stage fields $index, lanes=$lanes",
  (capture) => {
    expect(!nativeDatumIsIdentity(capture.matrices[1], Number.EPSILON)).toBe(
      capture.applied[1],
    );
    for (const field of ["positions", "normals", "faceNormals"] as const) {
      let current: Float32Array = values(capture.before[field]);
      for (let stage = 0; stage < 2; stage++) {
        if (capture.applied[stage])
          current = transformDatumCoordinates(
            current,
            capture.matrices[stage],
            field !== "positions",
          );
        expect(bits(current)).toBe(capture.outputs[stage][field]);
      }
      const stages = capture.matrices.filter(
        (_matrix, stage) => capture.applied[stage],
      );
      expect(
        bits(
          transformDatumCoordinateStages(
            values(capture.before[field]),
            stages,
            field !== "positions",
          ),
        ),
      ).toBe(capture.outputs[1][field]);
    }
  },
);
it("retains coordinate limits while accepting finite non-unit direction data", () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  expect(() => transformDatumCoordinates([1e18, 0, 0], identity)).toThrow(
    "supported range",
  );
  expect(transformDatumCoordinates([1e18, 0, 0], identity, true)[0]).toBe(
    Math.fround(1e18),
  );
  expect(() => transformDatumCoordinateStages([0, 0, 0], [])).toThrow("stages");
});
