import { expect, it, vi } from "vitest";
import { createCadFeature } from "../src/automation/operations";
import type { CadClient } from "../src/cad/client";
import type { ParametricRecipe } from "../src/parametric";

async function splitFixture() {
  let next = 0;
  const mesh = () => ({
    kernelId: `native-${++next}`,
    brep: "exact",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  });
  const cad = {
    primitive: vi.fn(async () => mesh()),
    split: vi.fn(async () => [mesh(), mesh()]),
    boolean: vi.fn(async () => mesh()),
    release: vi.fn(async () => {}),
  } as unknown as CadClient;
  const recipe: ParametricRecipe = {
    kind: "primitive",
    input: { kind: "box", center: [0, 0, 0], size: [10, 10, 10] },
  };
  const source = await createCadFeature(cad, [], recipe, "Source");
  const cutter = await createCadFeature(cad, source.entities, recipe, "Cutter");
  const split = await createCadFeature(
    cad,
    cutter.entities,
    {
      kind: "split",
      source: { featureId: source.created[0].parametric!.feature.id },
      cutter: { featureId: cutter.created[0].parametric!.feature.id },
    },
    "Split",
  );
  return { cad, cutter: cutter.created[0], split };
}
it("hides only the referenced split output, preserving an unused visible sibling", async () => {
  const h = await splitFixture();
  const [inside, outside] = h.split.created;
  const result = await createCadFeature(
    h.cad,
    h.split.entities,
    {
      kind: "boolean",
      operation: "subtract",
      first: { featureId: inside.parametric!.feature.id, output: 0 },
      second: { featureId: h.cutter.parametric!.feature.id },
    },
    "Result",
    { hideInputs: true },
  );
  expect(result.entities.find((e) => e.id === inside.id)?.visible).toBe(false);
  expect(result.entities.find((e) => e.id === outside.id)?.visible).toBe(true);
  expect(result.entities.find((e) => e.id === h.cutter.id)?.visible).toBe(
    false,
  );
  expect(h.split.entities.find((e) => e.id === inside.id)?.visible).toBe(true);
});
it("names exact split outputs by their inside/outside roles", async () => {
  const h = await splitFixture();
  expect(h.split.created.map((e) => e.name)).toEqual([
    "Split inside",
    "Split outside",
  ]);
  expect(h.split.created.map((e) => e.parametric!.output)).toEqual([0, 1]);
});
