import type { Entity, KernelMesh } from "./types";
import {
  validateParametricModel,
  type FeatureRef,
  type ParametricFeature,
  type ParametricModel,
  type ParametricState,
} from "./parametric";

export function entityFeatureModel(entities: Entity[]): ParametricModel {
  const features = new Map<string, ParametricFeature>();
  const slots = new Map<string, Set<number>>();
  for (const entity of entities) {
    if (entity.parametric === undefined) continue;
    if (!entity.parametric || typeof entity.parametric !== "object")
      throw new Error("Invalid parametric entity binding.");
    const { feature, output } = entity.parametric;
    if (
      !feature ||
      !Number.isSafeInteger(output) ||
      output < 0 ||
      output > (feature.recipe?.kind === "split" ? 1 : 0)
    )
      throw new Error("Invalid parametric entity output.");
    const previous = features.get(feature.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(feature))
      throw new Error("Conflicting recipes for one parametric feature.");
    features.set(feature.id, feature);
    const outputs = slots.get(feature.id) ?? new Set<number>();
    if (outputs.has(output))
      throw new Error("Duplicate parametric output entity.");
    outputs.add(output);
    slots.set(feature.id, outputs);
  }
  const model: ParametricModel = {
    format: "scanforge-parametric",
    version: 1,
    features: [...features.values()],
  };
  validateParametricModel(model);
  for (const feature of features.values())
    if (
      slots.get(feature.id)!.size !== (feature.recipe.kind === "split" ? 2 : 1)
    )
      throw new Error("Parametric feature outputs are incomplete.");
  return model;
}

export function entityFeatureState(entities: Entity[]): ParametricState {
  const model = entityFeatureModel(entities);
  const results: Record<string, KernelMesh[]> = Object.create(null);
  for (const entity of entities) {
    if (!entity.parametric) continue;
    if (!entity.kernelId)
      throw new Error("Restore exact CAD before parametric rebuilding.");
    const { feature, output } = entity.parametric;
    const outputs = (results[feature.id] ??= []);
    if (outputs[output]) throw new Error("Duplicate parametric output entity.");
    outputs[output] = {
      kernelId: entity.kernelId,
      positions: Array.from(entity.positions),
      brep: entity.brep,
    };
  }
  for (const feature of model.features) {
    const outputs = results[feature.id];
    const count = feature.recipe.kind === "split" ? 2 : 1;
    if (
      outputs?.length !== count ||
      Array.from({ length: count }, (_, i) => outputs[i]).some((x) => !x)
    )
      throw new Error("Parametric feature outputs are incomplete.");
  }
  return { model, results };
}

/** Existing CAD becomes an immutable imported seed when first used by a dependent feature. */
export function bindFeatureInputs(
  entities: Entity[],
  ids: string[],
): { entities: Entity[]; refs: FeatureRef[] } {
  let next = [...entities];
  const refs = ids.map((id) => {
    const entity = next.find((e) => e.id === id);
    if (!entity?.kernelId || !entity.brep)
      throw new Error("Parametric dependency requires exact CAD.");
    let binding = entity.parametric;
    if (!binding) {
      binding = {
        feature: {
          id: crypto.randomUUID(),
          name: entity.name,
          recipe: { kind: "importBrep", brep: entity.brep },
        },
        output: 0,
      };
      next = next.map((e) => (e.id === id ? { ...e, parametric: binding } : e));
    }
    return { featureId: binding.feature.id, output: binding.output };
  });
  return { entities: next, refs };
}
