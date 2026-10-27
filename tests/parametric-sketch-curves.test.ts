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
  it.each([undefined, 0])(
    "preserves legacy model admission with default distance %s",
    (oppositeDistance) => {
      const item = {
        ...feature({ kind: "sketch-curves", sketch: sketch() }),
        recipe: {
          kind: "extrude",
          profile: { kind: "sketch-curves", sketch: sketch() },
          height: 1e9 + 1,
          ...(oppositeDistance === undefined ? {} : { oppositeDistance }),
        },
      };
      expect(() =>
        validateParametricModel({
          format: "scanforge-parametric",
          version: 1,
          features: [item],
        }),
      ).not.toThrow();
    },
  );
  it.each(["polygon", "sketch"] as const)(
    "places two-sided %s profiles without changing authored data",
    async (kind) => {
      const input = sketch();
      const profile =
        kind === "polygon"
          ? {
              kind: "polygon" as const,
              points: [
                [0, 0],
                [1, 0],
                [0, 1],
              ] as [number, number][],
            }
          : { kind: "sketch" as const, sketch: input, chordTolerance: 0.1 };
      const recipe = {
        kind: "extrude" as const,
        profile,
        height: 5,
        oppositeDistance: 3,
      };
      const extrude = vi.fn(async (..._args: unknown[]) => mesh);
      await createCadEvaluator({ extrude } as unknown as CadClient).evaluate(
        { id: "profile", name: "Profile", recipe },
        [],
      );
      expect(extrude.mock.calls[0][1]).toBe(8);
      expect((extrude.mock.calls[0][2] as { origin: number[] }).origin).toEqual(
        kind === "polygon" ? [0, 0, -3] : [4, 0, 0],
      );
      expect(input.frame?.origin).toEqual([7, 0, 0]);
    },
  );
  it.each([-1, Infinity, NaN, 1e9])(
    "rejects invalid opposite distance %s",
    (oppositeDistance) => {
      const item = {
        ...feature({ kind: "sketch-curves", sketch: sketch() }),
        recipe: {
          kind: "extrude",
          profile: { kind: "sketch-curves", sketch: sketch() },
          height: 5,
          oppositeDistance,
        },
      };
      expect(() =>
        validateParametricModel({
          format: "scanforge-parametric",
          version: 1,
          features: [item],
        }),
      ).toThrow(/opposite extrusion/i);
    },
  );
  it("extrudes on both sides of a placed sketch without changing the saved frame", async () => {
    const input = sketch();
    const recipe = {
      kind: "extrude" as const,
      profile: { kind: "sketch-curves" as const, sketch: input },
      height: 5,
      oppositeDistance: 3,
    };
    const item: ParametricFeature = {
      id: "two-sided",
      name: "Two sided",
      recipe,
    };
    expect(() =>
      validateParametricModel({
        format: "scanforge-parametric",
        version: 1,
        features: [item],
      }),
    ).not.toThrow();
    const extrudeCurves = vi.fn(async (..._args: unknown[]) => mesh);
    await createCadEvaluator({
      extrudeCurves,
    } as unknown as CadClient).evaluate(item, []);
    expect(extrudeCurves.mock.calls[0][1]).toBe(8);
    expect(extrudeCurves.mock.calls[0][2]).toEqual({
      ...input.frame,
      origin: [4, 0, 0],
    });
    expect(input.frame?.origin).toEqual([7, 0, 0]);
  });

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
