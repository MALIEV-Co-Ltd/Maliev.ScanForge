import * as THREE from "three";

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
    material.onBeforeCompile = (shader) => {
      shader.uniforms.selectionProcessing = this.active;
      shader.uniforms.selectionProcessingTime = this.time;
      shader.uniforms.selectionCenter = { value: center };
      shader.uniforms.selectionScale = { value: scale };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 selectionPosition;\nuniform vec3 selectionCenter;\nuniform float selectionScale;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nselectionPosition = (position - selectionCenter) / selectionScale;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 selectionPosition;\nuniform bool selectionProcessing;\nuniform float selectionProcessingTime;",
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          if (selectionProcessing) {
            float wave = sin(dot(selectionPosition, vec3(5.0, 4.0, 3.0)) - selectionProcessingTime * 2.2);
            float flow = 0.5 + 0.5 * wave;
            vec3 violet = vec3(0.42, 0.15, 0.95);
            vec3 cyan = vec3(0.05, 0.8, 0.95);
            vec3 rose = vec3(1.0, 0.2, 0.48);
            diffuseColor.rgb = mix(mix(violet, cyan, flow), rose, 0.25 + 0.2 * sin(selectionProcessingTime + selectionPosition.y * 5.0));
            diffuseColor.a *= 0.8 + 0.2 * flow;
          }
        `,
        );
    };
    material.customProgramCacheKey = () => "selection-processing-v1";
  }
}
