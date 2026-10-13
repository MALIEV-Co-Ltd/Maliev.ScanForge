import { expect, it } from "vitest";
import * as THREE from "three";
import { SelectionProcessingHighlight } from "../src/selection-processing-highlight";

it("uses the outward ripple and dark fine wireframe for every processing mode", () => {
  const effect = new SelectionProcessingHighlight();
  const geometry = new THREE.PlaneGeometry(4, 4, 2, 2).toNonIndexed();
  const material = new THREE.MeshBasicMaterial({ color: "#e44b5b" });
  const lines = effect.install(material, geometry);
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
  };
  material.onBeforeCompile(
    shader as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
  expect(shader.fragmentShader).not.toContain("selectionSmoothing");
  expect(shader.fragmentShader).toContain("float wireVisibility = wave;");
  expect(shader.fragmentShader).toContain("smoothstep(0.15, 0.65,");
  expect(shader.fragmentShader).toContain("vec3(0.018, 0.023, 0.030)");
  for (const mode of ["boundary", "smoothing"] as const) {
    effect.setActive(true, false, mode);
    expect(shader.uniforms.selectionProcessing.value).toBe(true);
    expect(shader.uniforms.selectionSmoothing).toBeUndefined();
    expect(effect.update(100)).toBe(true);
    effect.setActive(false);
    expect(shader.uniforms.selectionProcessing.value).toBe(false);
    expect(lines.every((line) => !line.visible)).toBe(true);
  }
  lines.forEach((line) => {
    line.geometry.dispose();
    line.material.dispose();
  });
  material.dispose();
  geometry.dispose();
});

it("animates only while processing and restores the unmodified selection shader path afterwards", () => {
  const effect = new SelectionProcessingHighlight();
  const material = new THREE.MeshBasicMaterial({
    color: "#e44b5b",
    opacity: 0.7,
  });
  const geometry = new THREE.BoxGeometry(20, 10, 5).toNonIndexed();
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
  expect(shader.uniforms.selectionProcessingTime.value).toBe(0);
  effect.update(4);
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

it("keeps a restrained outline while the ripple animates, hides it after processing, and releases disposed outlines", () => {
  const effect = new SelectionProcessingHighlight();
  const geometry = new THREE.PlaneGeometry(1, 1, 20, 20).toNonIndexed();
  const material = new THREE.MeshBasicMaterial({ color: "#e44b5b" });
  const lines = effect.install(material, geometry);
  expect(lines).toHaveLength(1);
  expect(lines[0].material.blending).toBe(THREE.NormalBlending);
  expect(lines[0].material.linewidth).toBe(2.25);
  expect(lines.every((line) => !line.visible)).toBe(true);
  // Only the perimeter is emitted, regardless of the dense interior triangles.
  expect(lines[0].geometry.getAttribute("instanceStart").count).toBe(80);
  effect.setActive(true);
  expect(lines.every((line) => line.visible)).toBe(true);
  const peakWidth = lines[0].material.linewidth;
  const peakOpacity = lines[0].material.opacity;
  effect.update(0);
  effect.update(Math.PI / 3);
  expect(lines[0].material.linewidth).toBe(peakWidth);
  expect(lines[0].material.opacity).toBe(peakOpacity);
  effect.setActive(false);
  expect(lines.every((line) => !line.visible)).toBe(true);
  effect.setActive(true, true);
  const staticWidth = lines[0].material.linewidth;
  expect(effect.update(20)).toBe(false);
  expect(lines[0].material.linewidth).toBe(staticWidth);
  for (const line of lines) {
    line.geometry.dispose();
    line.material.dispose();
  }
  effect.setActive(false);
  // Disposed outlines are no longer updated by later state changes.
  expect(lines.every((line) => line.visible)).toBe(true);
  geometry.dispose();
  material.dispose();
});

it("starts each smoothing ripple at the surface center and uses a static reduced-motion fallback", () => {
  const effect = new SelectionProcessingHighlight();
  const geometry = new THREE.PlaneGeometry(4, 4, 2, 2).toNonIndexed();
  const material = new THREE.MeshBasicMaterial({
    color: "#e44b5b",
    opacity: 0.7,
  });
  const lines = effect.install(material, geometry);
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
  };
  material.onBeforeCompile(
    shader as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
  effect.setActive(true, false, "smoothing");
  effect.update(100);
  expect(shader.uniforms.selectionProcessingTime.value).toBe(0);
  expect(shader.uniforms.selectionSmoothing).toBeUndefined();
  expect(
    (shader.uniforms.selectionCenter.value as THREE.Vector3).length(),
  ).toBe(0);
  effect.update(101);
  expect(shader.uniforms.selectionProcessingTime.value).toBe(1);
  effect.setActive(false);
  effect.setActive(true, true, "smoothing");
  expect(shader.uniforms.selectionMotionEnabled.value).toBe(false);
  expect(effect.update(102)).toBe(false);
  expect(shader.uniforms.selectionProcessingTime.value).toBe(0);
  effect.setActive(false);
  effect.setActive(true, false, "smoothing");
  effect.update(500);
  expect(shader.uniforms.selectionProcessingTime.value).toBe(0);
  lines.forEach((line) => {
    line.geometry.dispose();
    line.material.dispose();
  });
  material.dispose();
  geometry.dispose();
});
