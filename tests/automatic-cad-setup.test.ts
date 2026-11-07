import { expect, it } from "vitest";
import { automaticCadSetup } from "../src/automatic-cad-setup";
import {
  buildDatumAlignment,
  transformDatumCoordinates,
} from "../src/datum-alignment";
import type { Entity } from "../src/types";
export function cadSetupFixture(): Entity {
  const points: number[] = [];
  for (const z of [0, 3])
    for (let i = 0; i <= 20; i++)
      for (let j = 0; j <= 10; j++) {
        const x = i - 10,
          y = j - 5,
          c = Math.cos(0.43),
          s = Math.sin(0.43),
          a = x * c - y * s,
          b = x * s + y * c;
        points.push(
          a + 32,
          b * Math.cos(0.6) - z * Math.sin(0.6) - 18,
          b * Math.sin(0.6) + z * Math.cos(0.6) + 75,
        );
      }
  return {
    id: "scan",
    name: "scan",
    kind: "pointcloud",
    positions: new Float32Array(points),
    color: "#fff",
    opacity: 1,
    visible: true,
  };
}
it.each(["center", "corner"] as const)(
  "places a tilted rectangular base on XY with %s origin",
  async (origin) => {
    const entity = cadSetupFixture(),
      before = entity.positions.slice();
    const setup = await automaticCadSetup(
      [entity],
      { referenceEntityId: entity.id, origin, planeTolerance: 0.01 },
      () => {},
    );
    const frame = buildDatumAlignment(
      setup.constraints,
      undefined,
      setup.translationPoint,
    );
    expect(frame.steps.every((s) => s.accepted)).toBe(true);
    const transformed = transformDatumCoordinates(
      entity.positions,
      frame.matrix,
    );
    const low = [0, 1, 2].map((a) =>
        Math.min(...Array.from(transformed).filter((_, i) => i % 3 === a)),
      ),
      high = [0, 1, 2].map((a) =>
        Math.max(...Array.from(transformed).filter((_, i) => i % 3 === a)),
      );
    expect(low[2]).toBeCloseTo(0, 4);
    expect(high[2]).toBeCloseTo(3, 4);
    expect(high[0] - low[0]).toBeCloseTo(20, 4);
    expect(high[1] - low[1]).toBeCloseTo(10, 4);
    expect(low[0]).toBeCloseTo(origin === "center" ? -10 : 0, 4);
    expect(low[1]).toBeCloseTo(origin === "center" ? -5 : 0, 4);
    expect(entity.positions).toEqual(before);
    expect(setup.diagnostics.planeSupportPercent).toBeGreaterThan(45);
  },
);
it("supports Y primary direction and base flip", async () => {
  const e = cadSetupFixture();
  const s = await automaticCadSetup(
    [e],
    { referenceEntityId: e.id, primaryAxis: "Y", flipBase: true },
    () => {},
  );
  expect(s.diagnostics.dimensions[1]).toBeCloseTo(20, 3);
  expect(s.diagnostics.dimensions[0]).toBeCloseTo(10, 3);
});
it("rejects missing reference, nonfinite data and cancellation", async () => {
  const e = cadSetupFixture();
  await expect(
    automaticCadSetup([e], { referenceEntityId: "missing" }, () => {}),
  ).rejects.toThrow(/reference/);
  await expect(
    automaticCadSetup([e], { referenceEntityId: e.id }, () => {
      throw Error("cancelled");
    }),
  ).rejects.toThrow(/cancelled/);
  e.positions[0] = NaN;
  await expect(
    automaticCadSetup([e], { referenceEntityId: e.id }, () => {}),
  ).rejects.toThrow(/finite/);
});

it("uses complete group bounds and preserves relative positions", async () => {
  const a = cadSetupFixture(),
    b = {
      ...a,
      id: "second",
      positions: new Float32Array(
        a.positions.map((v, i) => v + (i % 3 === 0 ? 5 : 0)),
      ),
    };
  const setup = await automaticCadSetup(
    [a, b],
    { referenceEntityId: a.id, origin: "corner" },
    () => {},
  );
  const frame = buildDatumAlignment(
    setup.constraints,
    undefined,
    setup.translationPoint,
  );
  const pa = transformDatumCoordinates(a.positions, frame.matrix),
    pb = transformDatumCoordinates(b.positions, frame.matrix);
  expect(Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2])).toBeCloseTo(
    5,
    4,
  );
  for (let axis = 0; axis < 3; axis++)
    expect(
      Math.min(
        ...Array.from(pa).filter((_, i) => i % 3 === axis),
        ...Array.from(pb).filter((_, i) => i % 3 === axis),
      ),
    ).toBeCloseTo(0, 4);
});
it("refuses collinear geometry and invalid tolerance", async () => {
  const e = cadSetupFixture();
  await expect(
    automaticCadSetup(
      [e],
      { referenceEntityId: e.id, planeTolerance: 0 },
      () => {},
    ),
  ).rejects.toThrow(/tolerance/);
  e.positions = new Float32Array(
    Array.from({ length: 30 }, (_, i) => [i, 0, 0]).flat(),
  );
  await expect(
    automaticCadSetup([e], { referenceEntityId: e.id }, () => {}),
  ).rejects.toThrow(/face|plane/);
});

it("refuses a curved scan without reliable plane support", async () => {
  const e = cadSetupFixture();
  const pts: number[] = [];
  for (let i = 0; i < 1500; i++) {
    const z = 1 - (2 * (i + 0.5)) / 1500,
      a = i * Math.PI * (3 - Math.sqrt(5)),
      r = Math.sqrt(1 - z * z);
    pts.push(r * Math.cos(a), r * Math.sin(a), z);
  }
  e.positions = new Float32Array(pts);
  await expect(
    automaticCadSetup([e], { referenceEntityId: e.id }, () => {}),
  ).rejects.toThrow(/flat supporting face/);
});
it("detects a proper orthonormal frame and flips the base normal", async () => {
  const e = cadSetupFixture(),
    a = await automaticCadSetup([e], { referenceEntityId: e.id }, () => {}),
    b = await automaticCadSetup(
      [e],
      { referenceEntityId: e.id, flipBase: true },
      () => {},
    );
  const dot = (x: number[], y: number[]) =>
    x.reduce((s, v, i) => s + v * y[i], 0);
  expect(dot(a.diagnostics.axes.z, b.diagnostics.axes.z)).toBeCloseTo(-1, 10);
  const { x, y, z } = a.diagnostics.axes;
  for (const axis of [x, y, z]) expect(dot(axis, axis)).toBeCloseTo(1, 10);
  expect(dot(x, y)).toBeCloseTo(0, 10);
  expect(dot(y, z)).toBeCloseTo(0, 10);
  expect(dot(x, z)).toBeCloseTo(0, 10);
  const cross = [
    x[1] * y[2] - x[2] * y[1],
    x[2] * y[0] - x[0] * y[2],
    x[0] * y[1] - x[1] * y[0],
  ];
  expect(dot(cross, z)).toBeCloseTo(1, 10);
});
