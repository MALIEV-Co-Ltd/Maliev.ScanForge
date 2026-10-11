import { describe, it, expect } from "vitest";
import {
  bindFeatureInputs,
  entityFeatureModel,
  entityFeatureState,
} from "../src/parametric-entities";
import type { Entity } from "../src/types";
const body: Entity = {
  id: "body",
  name: "Imported body",
  kind: "cad",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  kernelId: "live",
  brep: "native seed",
  color: "#00ffaa",
  visible: true,
  opacity: 1,
};
describe("parametric entity bindings", () => {
  it("seeds imported CAD immutably and reuses the output reference", () => {
    const seeded = bindFeatureInputs([body], [body.id, body.id]);
    expect(body.parametric).toBeUndefined();
    expect(seeded.refs[0]).toEqual(seeded.refs[1]);
    const state = entityFeatureState(seeded.entities);
    expect(state.model.features).toHaveLength(1);
    expect(state.results[seeded.refs[0].featureId][0].kernelId).toBe("live");
  });
  it("rejects duplicate outputs, conflicting recipes and incomplete split outputs", () => {
    const seeded = bindFeatureInputs([body], [body.id]).entities[0];
    expect(() =>
      entityFeatureModel([seeded, { ...seeded, id: "copy" }]),
    ).toThrow(/duplicate/i);
    expect(() =>
      entityFeatureModel([
        seeded,
        {
          ...seeded,
          id: "changed",
          parametric: {
            feature: { ...seeded.parametric!.feature, name: "Changed" },
            output: 0,
          },
        },
      ]),
    ).toThrow(/conflicting/i);
    const split: Entity = {
      ...body,
      id: "split",
      parametric: {
        feature: {
          id: "split",
          name: "Split",
          recipe: {
            kind: "split",
            source: { featureId: seeded.parametric!.feature.id },
            cutter: { featureId: seeded.parametric!.feature.id },
          },
        },
        output: 0,
      },
    };
    expect(() => entityFeatureModel([seeded, split])).toThrow(/incomplete/i);
  });
  it("requires restored native handles before rebuild and rejects null bindings", () => {
    const seeded = bindFeatureInputs([body], [body.id]).entities[0];
    expect(() =>
      entityFeatureState([{ ...seeded, kernelId: undefined }]),
    ).toThrow(/restore/i);
    expect(() =>
      entityFeatureModel([{ ...body, parametric: null as never }]),
    ).toThrow(/binding/i);
  });
});
