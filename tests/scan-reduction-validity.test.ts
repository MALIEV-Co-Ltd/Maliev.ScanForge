import { expect, it } from "vitest";
import {
  rejectReductionCollapse,
  type ReductionFace,
} from "../src/scan-reduction-validity";
import type { Vec3 } from "../src/types";
import fixture from "./fixtures/reduction-validity.json";

it.each(fixture.cases)(
  "matches native face validity and partial mask writes %#",
  (capture) => {
    const mask = new Uint32Array(capture.initialMask);
    const before = JSON.stringify([
      capture.vertices,
      capture.point,
      capture.faces,
      capture.references,
    ]);
    const result = rejectReductionCollapse(
      capture.point as Vec3,
      capture.other,
      capture.vertices,
      capture.faces as ReductionFace[],
      capture.references,
      mask,
    );
    expect(result).toBe(capture.rejected);
    expect(Array.from(mask)).toEqual(capture.mask);
    expect(
      JSON.stringify([
        capture.vertices,
        capture.point,
        capture.faces,
        capture.references,
      ]),
    ).toBe(before);
    expect(capture.inputsUnchanged && capture.guardsIntact).toBe(true);
  },
);
