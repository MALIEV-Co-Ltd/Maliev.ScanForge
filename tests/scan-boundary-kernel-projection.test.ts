import { expect, it } from "vitest";
import { CadClient } from "../src/cad/client";
import { fitBoundaryCurve } from "../src/scan-boundary-fit";
import { withCurvatureKernel } from "./helpers/curvature-kernel-vm";
import fixture from "./fixtures/boundary-smooth-observed-annulus.json";

it("projects the observed rim point through the pinned CAD kernel and releases its temporary curve", async () => {
  const unique = new Map<string, number[]>();
  for (let i = 0; i < fixture.source.length; i += 3) {
    const p = fixture.source.slice(i, i + 3);
    if (p[2] === 0.75) unique.set(JSON.stringify(p), p);
  }
  const points = [...unique.values()].sort(
    (a, b) =>
      ((Math.atan2(a[1], a[0]) + Math.PI * 2) % (Math.PI * 2)) -
      ((Math.atan2(b[1], b[0]) + Math.PI * 2) % (Math.PI * 2)),
  );
  const curve = fitBoundaryCurve(
    Float64Array.from([...points, points[0]].flat()),
    true,
    0.1,
  );
  await withCurvatureKernel(async () => {
    const cad = new CadClient();
    try {
      const source = new Float32Array([5, 0, 0.75]),
        before = source.slice();
      const projected = await cad.boundaryCurveProject(curve, source);
      expect(source).toEqual(before);
      expect(projected[0]).toBe(5.062124252319336);
      expect(Math.abs(projected[1])).toBeLessThan(1e-12);
      expect(projected[2]).toBe(0.75);
      const repeated = await cad.boundaryCurveProject(curve, source);
      expect(repeated).toEqual(projected);
      await expect(
        cad.boundaryCurveProject(curve, new Float32Array([NaN, 0, 0])),
      ).rejects.toThrow(/finite points/i);
      expect(await cad.boundaryCurveProject(curve, source)).toEqual(projected);
    } finally {
      cad.dispose();
    }
  });
}, 30000);
