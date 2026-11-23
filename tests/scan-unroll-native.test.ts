import tilted from "./fixtures/unroll-observed-tilted-cylinder.json";
import { expect, it } from "vitest";
import fixture from "./fixtures/unroll-observed-cylinder.json";
import { unrollScanMesh } from "../src/scan-tools-transforms";
import type { Vec3 } from "../src/types";

for (const sample of fixture.cases) {
  it(`matches observed cylinder export at ${sample.offsetDegrees} degrees with ${sample.instances} instances`, () => {
    const source = Float32Array.from(fixture.source);
    const before = source.slice();
    const result = unrollScanMesh(source, {
      center: fixture.center as Vec3,
      axis: fixture.axis as Vec3,
      radius: fixture.radius,
      offsetDegrees: sample.offsetDegrees,
      instances: sample.instances,
    });
    expect(result.positions.length).toBe(sample.facets * 9);
    // The imported CAD frame contributes sub-femtometre axial rotation.
    // Require exact corner order and Float32 arc/radial coordinates.
    for (let i = 0; i < result.positions.length; i++) {
      if (i % 3 === 1)
        expect(
          Math.abs(result.positions[i] - sample.positions[i]),
        ).toBeLessThan(1e-12);
      else expect(result.positions[i]).toBe(sample.positions[i]);
    }
    expect(source).toEqual(before);
  });
}

it("admits only bounded whole instance counts before output allocation", () => {
  for (const instances of [0, -1, 1.5, Infinity, 3_000_001])
    expect(() =>
      unrollScanMesh(fixture.source, {
        center: fixture.center as Vec3,
        axis: fixture.axis as Vec3,
        radius: fixture.radius,
        instances,
      }),
    ).toThrow(/instances|limit/i);
});

it("matches the observed nonorigin tilted-cylinder export", () => {
  const result = unrollScanMesh(tilted.positions, {
    center: tilted.center as Vec3,
    axis: tilted.axis as Vec3,
    radius: tilted.radius,
  });
  expect(result.positions.length).toBe(tilted.nativePositions.length);
  for (let i = 0; i < result.positions.length; i++) {
    if (i % 3 === 1)
      expect(
        Math.abs(result.positions[i] - tilted.nativePositions[i]),
      ).toBeLessThan(1e-12);
    else expect(result.positions[i]).toBe(tilted.nativePositions[i]);
  }
});
