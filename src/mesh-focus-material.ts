import type { MeshStandardMaterial } from "three";

export const INACTIVE_MESH_BRIGHTNESS = 0.12;

/** Preserve source colors and opacity; dim only objects outside the active focus. */
export function applyMeshFocus(
  material: MeshStandardMaterial,
  color: string,
  inactive: boolean,
): void {
  material.color.set(material.vertexColors ? "#ffffff" : color);
  if (inactive) material.color.multiplyScalar(INACTIVE_MESH_BRIGHTNESS);
  material.emissive.set("#000000");
  material.emissiveIntensity = 0;
}
