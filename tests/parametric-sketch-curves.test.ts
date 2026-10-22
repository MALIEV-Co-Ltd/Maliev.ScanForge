import { describe, expect, it, vi } from "vitest";
import {
  createCadEvaluator,
  validateParametricModel,
  type ParametricFeature,
} from "../src/parametric";
import { coordinateSketchFrame } from "../src/sketch-frame";
import type { CadClient } from "../src/cad/client";
import type { Sketch } from "../src/sketch";

const sketch = (): Sketch => ({
  version: 1,
  frame: coordinateSketchFrame("OYZ", 7),
  points: [
    { id: "a", x: 2, y: 0 },
    { id: "b", x: -2, y: 0 },
    { id: "c", x: 0, y: 0 },
  ],
  segments: [],
  arcs: [
    { id: "top", a: "a", b: "b", center: "c", clockwise: false },
    { id: "bottom", a: "b", b: "a", center: "c", clockwise: false },
  ],
  constraints: [],
});
const feature = (profile: unknown): ParametricFeature =>
  ({
    id: "curve-solid",
    name: "Curve solid",
    recipe: { kind: "extrude", profile, height: 5 },
  }) as ParametricFeature;
const model = (profile: unknown) => ({
  format: "scanforge-parametric",
  version: 1,
  features: [feature(profile)],
});
const mesh = {
  kernelId: "new-solid",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  brep: "exact-curve-brep",
};

describe("analytic sketch extrusion recipes", () => {
  it("validates and routes the explicit curve recipe with its solved frame and exact arcs", async () => {
    const input = sketch(),
      profile = { kind: "sketch-curves", sketch: input };
    expect(() => validateParametricModel(model(profile))).not.toThrow();
    const extrudeCurves = vi.fn(async () => mesh),
      extrude = vi.fn();
    const client = { extrudeCurves, extrude } as unknown as CadClient;
    const result = await createCadEvaluator(client).evaluate(
      feature(profile),
      [],
    );
    expect(extrudeCurves).toHaveBeenCalledWith(
      [
        {
          kind: "arc",
          start: [2, 0],
          end: [-2, 0],
          center: [0, 0],
          clockwise: false,
        },
        {
          kind: "arc",
          start: [-2, 0],
          end: [2, 0],
          center: [0, 0],
          clockwise: false,
        },
      ],
      5,
      input.frame,
    );
    expect(extrude).not.toHaveBeenCalled();
    expect(result).toEqual([mesh]);
  });

  it.each([{ chordTolerance: 0.1 }, { extra: true }])(
    "rejects fields that have no analytic meaning: %j",
    (extra) => {
      expect(() =>
        validateParametricModel(
          model({ kind: "sketch-curves", sketch: sketch(), ...extra }),
        ),
      ).toThrow(/unknown|field|chord/i);
    },
  );

  it("retains the chordal path for legacy sketch recipes", async () => {
    const input = sketch(),
      extrude = vi.fn(async (..._args: unknown[]) => mesh),
      extrudeCurves = vi.fn();
    const client = { extrude, extrudeCurves } as unknown as CadClient;
    await createCadEvaluator(client).evaluate(
      feature({ kind: "sketch", sketch: input, chordTolerance: 0.1 }),
      [],
    );
    expect(extrude).toHaveBeenCalledOnce();
    expect((extrude.mock.calls[0][0] as unknown[]).length).toBeGreaterThan(2);
    expect(extrudeCurves).not.toHaveBeenCalled();
  });

  it("rejects an invalid curve before acquiring a CAD handle", async () => {
    const input = sketch();
    input.arcs!.pop();
    const extrudeCurves = vi.fn();
    const client = { extrudeCurves } as unknown as CadClient;
    await expect(
      createCadEvaluator(client).evaluate(
        feature({ kind: "sketch-curves", sketch: input }),
        [],
      ),
    ).rejects.toThrow(/closed/i);
    expect(extrudeCurves).not.toHaveBeenCalled();
  });

  it("rejects conflicting constraints before acquiring a CAD handle", async () => {
    const input = sketch();
    input.constraints = [
      { id: "fix-a", kind: "fixed", point: "a", x: 2, y: 0 },
      { id: "also-fix-a", kind: "fixed", point: "a", x: 4, y: 0 },
    ];
    const extrudeCurves = vi.fn();
    await expect(
      createCadEvaluator({ extrudeCurves } as unknown as CadClient).evaluate(
        feature({ kind: "sketch-curves", sketch: input }),
        [],
      ),
    ).rejects.toThrow(/conflict/i);
    expect(extrudeCurves).not.toHaveBeenCalled();
  });
});
