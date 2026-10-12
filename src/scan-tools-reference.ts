import { fitPlane, fitCylinder } from "./geometry";
import type { Entity, Vec3, Positions } from "./types";
function referenceSamples(positions: Positions) {
  if (positions.length <= 6000) return positions;
  const out: number[] = [],
    points = positions.length / 3;
  for (let i = 0; i < 2000; i++) {
    const index = Math.floor((i * (points - 1)) / 1999) * 3;
    out.push(positions[index], positions[index + 1], positions[index + 2]);
  }
  return out;
}

export function mirrorReference(
  entity: Entity,
): { center: Vec3; normal: Vec3 } | null {
  if (entity.fit?.kind === "plane")
    return { center: entity.fit.center, normal: entity.fit.axis };
  if (!["plane", "cad"].includes(entity.kind) || entity.positions.length < 9)
    return null;
  // Only planar objects qualify. A general curved CAD body does not define a mirror plane.
  try {
    const fit = fitPlane(referenceSamples(entity.positions));
    if (fit.maxError > 0.001) return null;
    for (let i = 0; i < entity.positions.length; i += 3)
      if (
        Math.abs(
          fit.axis.reduce(
            (sum, v, a) => sum + v * (entity.positions[i + a] - fit.center[a]),
            0,
          ),
        ) > 0.001
      )
        return null;
    return { center: fit.center, normal: fit.axis };
  } catch {
    return null;
  }
}

export function cylinderReference(
  entity: Entity,
): { center: Vec3; axis: Vec3; radius: number } | null {
  if (entity.fit?.kind === "cylinder" && (entity.fit.radius ?? 0) > 0)
    return {
      center: entity.fit.center,
      axis: entity.fit.axis,
      radius: entity.fit.radius!,
    };
  const recipe = entity.parametric?.feature.recipe;
  if (recipe?.kind === "primitive" && recipe.input.kind === "cylinder")
    return {
      center: recipe.input.center,
      axis: recipe.input.axis,
      radius: recipe.input.radius,
    };
  // Fitted metadata is ephemeral in project files. Restore a pure cylindrical
  // construction/CAD surface from its geometry; arbitrary scans do not qualify.
  if (
    ["cylinder", "cad"].includes(entity.kind) &&
    entity.positions.length >= 24
  ) {
    try {
      const fit = fitCylinder(referenceSamples(entity.positions));
      if (fit.maxError > 0.001 || !(fit.radius! > 0)) return null;
      for (let i = 0; i < entity.positions.length; i += 3) {
        const delta = fit.center.map((v, a) => entity.positions[i + a] - v);
        const axial = delta.reduce((sum, v, a) => sum + v * fit.axis[a], 0);
        const radius = Math.hypot(
          ...delta.map((v, a) => v - axial * fit.axis[a]),
        );
        if (Math.abs(radius - fit.radius!) > 0.001) return null;
      }
      return { center: fit.center, axis: fit.axis, radius: fit.radius! };
    } catch {
      /* A general body does not define one cylindrical reference. */
    }
  }
  return null;
}
