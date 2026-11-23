import { expect, it } from "vitest";
import * as THREE from "three";
import { AdaptivePointDisplay } from "../src/adaptive-point-display";

function setup(count = 100000) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  positions.set([-5, -5, 0, 5, 5, 0]);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingBox();
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size: 1 }),
  );
  const display = new AdaptivePointDisplay(points);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.z = 40;
  camera.updateMatrixWorld(true);
  return { points, positions, display, camera };
}

it("restores detail on perspective and orthographic zoom while retaining source buffers", () => {
  const { display, camera, points, positions } = setup();
  const far = display.inspect(camera, 800, 800);
  expect(far).toMatchObject({
    density: 100,
    samplingMethod: "stable-sample",
    cellSizePx: null,
    maxScreenOffsetPx: 0,
  });
  expect(far.sampleFraction).toBeLessThan(1);
  camera.position.z = 10;
  camera.updateMatrixWorld(true);
  expect(display.inspect(camera, 800, 800).sampleFraction).toBeGreaterThan(
    far.sampleFraction,
  );
  const orthographic = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 100);
  orthographic.position.z = 10;
  orthographic.updateMatrixWorld(true);
  const wide = display.inspect(orthographic, 800, 800).sampleFraction;
  orthographic.zoom = 3;
  orthographic.updateProjectionMatrix();
  expect(
    display.inspect(orthographic, 800, 800).sampleFraction,
  ).toBeGreaterThan(wide);
  expect(points.geometry.getAttribute("position").array).toBe(positions);
  expect(points.geometry.index).toBeNull();
});

it("supports density and full display, accounts for hidden slots and world poses", () => {
  const { display, camera, points } = setup();
  display.setOptions({ pointDensity: 10 });
  const sparse = display.inspect(camera, 800, 800);
  expect(sparse.maxScreenOffsetPx).toBe(0);
  display.setOptions({ pointDensity: 100 });
  expect(display.inspect(camera, 800, 800).sampleFraction).toBeGreaterThan(
    sparse.sampleFraction,
  );
  points.scale.setScalar(2);
  expect(display.inspect(camera, 800, 800).sampleFraction).toBeGreaterThan(
    sparse.sampleFraction,
  );
  points.geometry.setIndex([0, 1]);
  expect(display.inspect(camera, 800, 800)).toMatchObject({
    eligiblePoints: 2,
    sampleFraction: 1,
    estimatedDisplayedPoints: 2,
  });
  points.geometry.setIndex(null);
  display.setOptions({ pointAutoDensity: false });
  expect(display.inspect(camera, 800, 800)).toMatchObject({
    sampleFraction: 1,
    samplingMethod: "full",
    cellSizePx: null,
    maxScreenOffsetPx: 0,
  });
});

it("samples original vertex IDs without moving retained points onto a display grid", () => {
  const { display, camera, points } = setup();
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.points.vertexShader,
  };
  points.material.onBeforeCompile(
    shader as Parameters<typeof points.material.onBeforeCompile>[0],
    {} as THREE.WebGLRenderer,
  );
  display.inspect(camera, 800, 800);
  expect(shader.vertexShader).toContain("gl_VertexID");
  expect(shader.vertexShader).not.toContain("gl_Position.xy =");
  expect(shader.vertexShader).not.toContain("scanPointCellSize");
});

it("uses conservative full detail at the near plane and stays deterministic for repeated views", () => {
  const { display, camera, points } = setup();
  expect(display.inspect(camera, 800, 800)).toEqual(
    display.inspect(camera, 800, 800),
  );
  points.rotation.y = Math.PI / 2;
  camera.position.z = 1;
  camera.updateMatrixWorld(true);
  expect(display.inspect(camera, 800, 800).sampleFraction).toBe(1);
  expect(display.inspect(camera, 0, 0).sampleFraction).toBe(1);
});

it("retains sparse clouds and reduces the budget for larger point footprints", () => {
  const sparse = setup(128);
  expect(sparse.display.inspect(sparse.camera, 800, 800)).toMatchObject({
    sampleFraction: 1,
    estimatedDisplayedPoints: 128,
  });
  const { display, camera, points } = setup();
  const small = display.inspect(camera, 800, 800).sampleFraction;
  points.material.size = 4;
  expect(display.inspect(camera, 800, 800).sampleFraction).toBeLessThan(small);
  points.geometry.boundingBox!.makeEmpty();
  expect(display.inspect(camera, 800, 800).sampleFraction).toBe(1);
});
