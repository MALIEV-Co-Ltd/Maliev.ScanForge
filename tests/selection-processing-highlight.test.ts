import { expect, it } from "vitest";
import * as THREE from "three";
import { SelectionProcessingHighlight } from "../src/selection-processing-highlight";

it("animates only while processing and restores the unmodified selection shader path afterwards", () => {
  const effect = new SelectionProcessingHighlight();
  const material = new THREE.MeshBasicMaterial({
    color: "#e44b5b",
    opacity: 0.7,
  });
  const geometry = new THREE.BoxGeometry(20, 10, 5);
  effect.install(material, geometry);
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
  };
  material.onBeforeCompile(
    shader as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
  expect(shader.uniforms.selectionProcessing.value).toBe(false);
  expect(shader.uniforms.selectionScale.value).toBe(20);
  expect(shader.fragmentShader).toContain("if (selectionProcessing)");
  expect(shader.fragmentShader).toContain(
    "#include <clipping_planes_fragment>",
  );
  expect(effect.update(1)).toBe(false);
  effect.setActive(true);
  expect(effect.update(2)).toBe(true);
  expect(shader.uniforms.selectionProcessingTime.value).toBe(2);
  effect.setActive(false);
  expect(effect.update(3)).toBe(false);
  expect(shader.uniforms.selectionProcessing.value).toBe(false);
  expect(material.color.getHexString()).toBe("e44b5b");
  expect(material.opacity).toBe(0.7);
  effect.setActive(true, true);
  expect(shader.uniforms.selectionProcessing.value).toBe(true);
  expect(shader.uniforms.selectionProcessingTime.value).toBe(0);
  expect(effect.update(4)).toBe(false);
  geometry.dispose();
  material.dispose();
});
