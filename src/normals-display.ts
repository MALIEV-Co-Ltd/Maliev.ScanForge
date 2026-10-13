import * as THREE from "three";

export const NORMALS_FRONT_COLOR = "#b8b8b8";
export const NORMALS_BACK_COLOR = "#e85a78";

/** Front/back classification uses rasterized triangle winding, independent of
 * smooth shading normals. Keep the standard lighting and clipping pipeline. */
export function installNormalsDisplay(material: THREE.MeshStandardMaterial) {
  const enabled = { value: false };
  const dim = { value: 1 };
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.uniforms.normalsDisplayEnabled = enabled;
    shader.uniforms.normalsDisplayDim = dim;
    shader.uniforms.normalsFrontColor = {
      value: new THREE.Color(NORMALS_FRONT_COLOR),
    };
    shader.uniforms.normalsBackColor = {
      value: new THREE.Color(NORMALS_BACK_COLOR),
    };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform bool normalsDisplayEnabled;\nuniform float normalsDisplayDim;\nuniform vec3 normalsFrontColor;\nuniform vec3 normalsBackColor;",
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nif (normalsDisplayEnabled) diffuseColor.rgb = (gl_FrontFacing ? normalsFrontColor : normalsBackColor) * normalsDisplayDim;",
      );
  };
  material.customProgramCacheKey = () =>
    previousCacheKey + ":mesh-normals-orientation-v1";
  material.needsUpdate = true;
  return (show: boolean, inactive = false) => {
    enabled.value = show;
    dim.value = inactive ? 0.45 : 1;
  };
}
