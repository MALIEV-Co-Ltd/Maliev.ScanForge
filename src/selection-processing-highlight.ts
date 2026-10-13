import * as THREE from "three";
import { installSelectionBoundaryAttributes } from "./selection-boundary-highlight";

/** A flowing highlight confined to the existing selected geometry. */
export class SelectionProcessingHighlight {
  private readonly active = { value: false };
  private readonly time = { value: 0 };
  private reducedMotion = false;

  setActive(active: boolean, reducedMotion = false) {
    this.active.value = active;
    this.reducedMotion = reducedMotion;
    if (!active || reducedMotion) this.time.value = 0;
  }

  update(seconds: number): boolean {
    if (!this.active.value || this.reducedMotion) return false;
    this.time.value = seconds;
    return true;
  }

  install(
    material: THREE.MeshBasicMaterial | THREE.PointsMaterial,
    geometry: THREE.BufferGeometry,
  ) {
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const scale = Math.max(size.x, size.y, size.z, 0.000001);
    const hasBoundary = material instanceof THREE.MeshBasicMaterial;
    if (hasBoundary) installSelectionBoundaryAttributes(geometry);
    const boundaryVaryings = hasBoundary
      ? "\nvarying vec3 selectionBarycentric;\nvarying vec3 selectionBoundary;"
      : "";
    material.onBeforeCompile = (shader) => {
      shader.uniforms.selectionProcessing = this.active;
      shader.uniforms.selectionProcessingTime = this.time;
      shader.uniforms.selectionCenter = { value: center };
      shader.uniforms.selectionScale = { value: scale };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 selectionPosition;\nuniform vec3 selectionCenter;\nuniform float selectionScale;" +
            boundaryVaryings +
            (hasBoundary
              ? "\nattribute vec3 processingBarycentric;\nattribute vec3 processingBoundary;"
              : ""),
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nselectionPosition = (position - selectionCenter) / selectionScale;" +
            (hasBoundary
              ? "\nselectionBarycentric = processingBarycentric;\nselectionBoundary = processingBoundary;"
              : ""),
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 selectionPosition;\nuniform bool selectionProcessing;\nuniform float selectionProcessingTime;" +
            boundaryVaryings,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          if (selectionProcessing) {
            float phase = dot(selectionPosition, vec3(6.0, 4.0, 3.0));
            float flow = 0.5 + 0.5 * sin(phase - selectionProcessingTime * 1.8 + 0.6 * sin(selectionPosition.y * 7.0 + selectionProcessingTime));
            float pulse = 0.5 + 0.5 * sin(selectionProcessingTime * 2.4);
            vec3 brightRed = vec3(1.0, 0.055, 0.075);
            float brightness = 0.25 + 0.55 * pulse + 0.20 * flow;
            float rim = 0.0;
            ${
              hasBoundary
                ? `vec3 edgeDistance = selectionBarycentric / max(fwidth(selectionBarycentric), vec3(0.0001));
            vec3 glow = (vec3(1.0) - smoothstep(vec3(0.0), vec3(4.0 + 2.0 * pulse), edgeDistance)) * selectionBoundary;
            rim = max(glow.x, max(glow.y, glow.z));`
                : ""
            }
            diffuseColor.rgb = mix(mix(diffuseColor.rgb, brightRed, brightness), vec3(1.0, 0.20, 0.23), rim * (0.65 + 0.35 * pulse));
            diffuseColor.a *= mix(0.60 + 0.12 * flow + 0.12 * pulse, 1.0, rim);
          }
        `,
        );
    };
    material.customProgramCacheKey = () =>
      `selection-processing-red-v3:${hasBoundary}`;
  }
}
