import type { MeshStandardMaterial } from "three";

/** Preserve source colors and opacity; dim only objects outside the active focus. */
export function applyMeshFocus(
  material: MeshStandardMaterial,
  color: string,
  inactive: boolean,
): void {
  material.color.set(material.vertexColors ? "#ffffff" : color);
  if (inactive) material.color.multiplyScalar(0.42);
  material.emissive.set("#000000");
  material.emissiveIntensity = 0;
}
