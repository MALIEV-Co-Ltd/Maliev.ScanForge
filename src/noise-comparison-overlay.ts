import * as THREE from "three";
import type { Positions } from "./types";

const linearChannels = new Float32Array(256);
const channelColor = new THREE.Color();
for (let value = 0; value < 256; value++) {
  channelColor.setRGB(value / 255, 0, 0, THREE.SRGBColorSpace);
  linearChannels[value] = channelColor.r;
}

/** Unlit colors on the original surface, independently owned by this overlay. */
export function createNoiseComparisonOverlay(
  positions: Positions,
  rgb: Uint8Array,
  hidden: readonly number[] = [],
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  if (
    !positions.length ||
    positions.length % 9 ||
    rgb.length !== positions.length
  )
    throw new Error(
      "Noise comparison colors must match complete original triangles.",
    );
  const coordinates = new Float32Array(positions);
  if (!coordinates.every(Number.isFinite))
    throw new Error("Noise comparison coordinates must be finite.");
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(coordinates, 3));
  const colors = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) {
    colors[i] = linearChannels[rgb[i]];
    colors[i + 1] = linearChannels[rgb[i + 1]];
    colors[i + 2] = linearChannels[rgb[i + 2]];
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  if (hidden.length) {
    const skipped = new Set(
      hidden.filter(
        (id) =>
          Number.isSafeInteger(id) && id >= 0 && id < positions.length / 9,
      ),
    );
    const indices = new Uint32Array((positions.length / 9 - skipped.size) * 3);
    let cursor = 0;
    for (let face = 0; face < positions.length / 9; face++)
      if (!skipped.has(face)) {
        indices[cursor++] = face * 3;
        indices[cursor++] = face * 3 + 1;
        indices[cursor++] = face * 3 + 2;
      }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Original surface noise comparison";
  mesh.raycast = () => {}; // Read-only comparison, not a mesh-selection target.
  return mesh;
}
