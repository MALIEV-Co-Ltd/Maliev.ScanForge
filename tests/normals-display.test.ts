import { expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  installNormalsDisplay,
  NORMALS_FRONT_COLOR,
  NORMALS_BACK_COLOR,
} from "../src/normals-display";
import { installDeviationHeatmap } from "../src/deviation-heatmap";
import { flipScanNormals } from "../src/scan-tools-transforms";
import { Viewport } from "../src/viewport";

function compile(material: THREE.MeshStandardMaterial) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader as any, {} as any);
  return shader;
}
it("colors front and back winding distinctly without replacing lighting or clipping", () => {
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const update = installNormalsDisplay(material);
  const shader = compile(material);
  expect(shader.fragmentShader).toContain(
    "gl_FrontFacing ? normalsFrontColor : normalsBackColor",
  );
  expect(shader.fragmentShader).toContain("#include <lights_fragment_begin>");
  expect(shader.fragmentShader).toContain(
    "#include <clipping_planes_fragment>",
  );
  expect(shader.uniforms.normalsFrontColor.value).toEqual(
    new THREE.Color(NORMALS_FRONT_COLOR),
  );
  expect(shader.uniforms.normalsBackColor.value).toEqual(
    new THREE.Color(NORMALS_BACK_COLOR),
  );
  expect(shader.uniforms.normalsDisplayEnabled.value).toBe(false);
  const version = material.version;
  update(true, true);
  expect(shader.uniforms.normalsDisplayEnabled.value).toBe(true);
  expect(shader.uniforms.normalsDisplayDim.value).toBe(0.12);
  update(false);
  expect(shader.uniforms.normalsDisplayEnabled.value).toBe(false);
  expect(material.version).toBe(version);
  material.dispose();
});
it("composes with deviation colors and restores them when normals is off", () => {
  const geometry = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  const material = new THREE.MeshStandardMaterial();
  const setBounds = installDeviationHeatmap(
    new THREE.Mesh(geometry, material),
    { distances: new Float32Array([0, 0.1, -0.1]), lower: -0.05, upper: 0.05 },
  );
  const update = installNormalsDisplay(material);
  const shader = compile(material);
  expect(shader.fragmentShader.indexOf("gl_FrontFacing")).toBeGreaterThan(
    shader.fragmentShader.indexOf("vec3 ramp"),
  );
  expect(material.customProgramCacheKey()).toContain(
    "signed-deviation-tolerance-v1",
  );
  setBounds({ lower: -0.2, upper: 0.2 });
  expect(shader.uniforms.deviationUpper.value).toBe(0.2);
  update(true);
  expect(shader.uniforms.normalsDisplayEnabled.value).toBe(true);
  update(false);
  expect(shader.uniforms.normalsDisplayEnabled.value).toBe(false);
  geometry.dispose();
  material.dispose();
});
it("flipping normals reverses the actual visible triangle side, not just shading normals", () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const original = Array.from(positions);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0.2, 0.2, 1),
    new THREE.Vector3(0, 0, -1),
  );
  const geometry = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  const material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
  const mesh = new THREE.Mesh(geometry, material);
  expect(ray.intersectObject(mesh)).toHaveLength(1);
  const flipped = flipScanNormals(positions).positions;
  const reversed = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute(flipped, 3),
  );
  expect(ray.intersectObject(new THREE.Mesh(reversed, material))).toHaveLength(
    0,
  );
  material.side = THREE.BackSide;
  expect(ray.intersectObject(new THREE.Mesh(reversed, material))).toHaveLength(
    1,
  );
  expect(Array.from(positions)).toEqual(original);
  geometry.dispose();
  reversed.dispose();
  material.dispose();
});
it("keeps selections visible and preserves deviation colors with default normals enabled", () => {
  const view = Object.create(Viewport.prototype) as any;
  const material = new THREE.MeshStandardMaterial();
  const update = installNormalsDisplay(material);
  Object.assign(view, {
    objects: new Map(),
    normalsMaterials: new WeakMap([[material, update]]),
    triangleSelection: new THREE.Group(),
    noiseComparisonGroup: new THREE.Group(),
    invalidate: vi.fn(),
  });
  view.noiseComparisonGroup.add(
    new THREE.Mesh(new THREE.BufferGeometry(), material),
  );
  const shader = compile(material);
  view.setNormalsDisplay(true);
  expect(view.triangleSelection.visible).toBe(true);
  expect(shader.uniforms.normalsDisplayEnabled.value).toBe(false);
  view.setNormalsDisplay(false);
  expect(view.triangleSelection.visible).toBe(true);
  expect(shader.uniforms.normalsDisplayEnabled.value).toBe(false);
  material.dispose();
});

it("inspection colors override orientation shading and restore it after clearing", () => {
  const material = new THREE.MeshStandardMaterial();
  material.userData.normalsMesh = true;
  const update = installNormalsDisplay(material),
    shader = compile(material);
  const geometry = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 1], 3),
  );
  const mesh = new THREE.Mesh(geometry, material),
    view = Object.create(Viewport.prototype) as Viewport;
  Object.assign(view, {
    objects: new Map([["scan", { mesh, color: "#fff" }]]),
    selectedId: "scan",
    normalsMaterials: new WeakMap([[material, update]]),
    invalidate: vi.fn(),
  });
  try {
    view.setNormalsDisplay(true);
    expect(shader.uniforms.normalsDisplayEnabled.value).toBe(true);
    view.setDeviation("scan", new Float32Array([-1, 0, 1]), 1);
    expect(shader.uniforms.normalsDisplayEnabled.value).toBe(false);
    view.setNormalsDisplay(true);
    expect(shader.uniforms.normalsDisplayEnabled.value).toBe(false);
    view.setDeviation("scan", null, 1);
    expect(shader.uniforms.normalsDisplayEnabled.value).toBe(true);
  } finally {
    geometry.dispose();
    material.dispose();
  }
});
