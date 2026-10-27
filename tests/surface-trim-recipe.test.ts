import { expect, it, vi } from "vitest";
import {
  createCadEvaluator,
  featureDependencies,
  validateParametricModel,
  type ParametricFeature,
} from "../src/parametric";
import type { CadClient } from "../src/cad/client";

const recipe = () => ({
  kind: "trimSurfaces",
  source: { featureId: "source", output: 0 },
  cutters: [{ featureId: "cutter", output: 0 }],
  keepPoints: [[-2, 0, 0]],
  toleranceMm: 0.001,
});
const feature = (id: string): ParametricFeature => ({
  id,
  name: id,
  recipe: {
    kind: "primitive",
    input: { kind: "box", center: [0, 0, 0], size: [1, 1, 1] },
  },
});
const model = (value: unknown) => ({
  format: "scanforge-parametric",
  version: 1,
  features: [
    feature("source"),
    feature("cutter"),
    { id: "trim", name: "Trim", recipe: value },
  ],
});

it("validates and preserves every trim dependency and world-space parameter", () => {
  const value = recipe();
  expect(() => validateParametricModel(model(value))).not.toThrow();
  expect(featureDependencies(value as any)).toEqual([
    value.source,
    ...value.cutters,
  ]);
});
it("rejects malformed, duplicate and self-referencing trim inputs", () => {
  for (const change of [
    { cutters: [] },
    { cutters: [{ featureId: "source", output: 0 }] },
    { keepPoints: [] },
    { keepPoints: [[Infinity, 0, 0]] },
    { toleranceMm: 0 },
    { cutters: [{ featureId: "cutter" }, { featureId: "cutter" }] },
  ])
    expect(() =>
      validateParametricModel(model({ ...recipe(), ...change })),
    ).toThrow();
});
it("evaluates trim through the exact CAD client without substituting meshes", async () => {
  const output = {
    kernelId: "trimmed",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    brep: "BREP",
  };
  const client = {
    trimSurfaces: vi.fn(async () => output),
    release: vi.fn(),
  } as unknown as CadClient;
  const result = await createCadEvaluator(client).evaluate(
    { id: "trim", name: "Trim", recipe: recipe() as any },
    [
      { kernelId: "source-native", positions: [] },
      { kernelId: "cutter-native", positions: [] },
    ],
  );
  expect(client.trimSurfaces).toHaveBeenCalledWith(
    "source-native",
    ["cutter-native"],
    [[-2, 0, 0]],
    0.001,
  );
  expect(result).toEqual([output]);
});
