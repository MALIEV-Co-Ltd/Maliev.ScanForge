import * as THREE from "three";
import type { Entity } from "./types";
import { DEFAULT_POINT_DENSITY } from "./appearance";

type Options = Pick<Entity, "pointAutoDensity" | "pointDensity">;

/** Display-only stable sampling; retained points keep their original positions. */
export class AdaptivePointDisplay {
  private options: Options = {};
  private fraction = { value: 1 };
  private matrix = new THREE.Matrix4();
  private corner = new THREE.Vector4();
  constructor(
    private points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>,
  ) {
    const material = points.material;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.scanPointFraction = this.fraction;
      shader.vertexShader =
        `uniform float scanPointFraction;\n${shader.vertexShader}`.replace(
          "#include <fog_vertex>",
          `#include <fog_vertex>
        if (scanPointFraction < 1.0) {
          uint slot = uint(gl_VertexID);
          slot ^= slot >> 16;
          slot *= 0x7feb352du;
          slot ^= slot >> 15;
          slot *= 0x846ca68bu;
          slot ^= slot >> 16;
          float rank = float(slot) / 4294967296.0;
          if (rank >= scanPointFraction) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
        );
    };
    material.customProgramCacheKey = () => "scan-point-stable-sample-v3";
    const viewport = new THREE.Vector2();
    points.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getSize(viewport);
      this.inspect(camera, viewport.x, viewport.y);
    };
  }

  setOptions(options: Options): void {
    this.options = {
      pointAutoDensity: options.pointAutoDensity,
      pointDensity: options.pointDensity,
    };
  }

  inspect(camera: THREE.Camera, width: number, height: number) {
    const { geometry, material } = this.points;
    const eligiblePoints =
      geometry.index?.count ?? geometry.getAttribute("position").count;
    const autoDensity = this.options.pointAutoDensity ?? true;
    const density = this.options.pointDensity ?? DEFAULT_POINT_DENSITY;
    const spacing = (material.size + 1) * Math.sqrt(100 / density);
    let sampleFraction = 1;
    if (
      autoDensity &&
      eligiblePoints > 256 &&
      width > 0 &&
      height > 0 &&
      geometry.boundingBox &&
      !geometry.boundingBox.isEmpty()
    ) {
      camera.updateMatrixWorld(true);
      this.points.updateWorldMatrix(true, false);
      this.matrix
        .copy(camera.projectionMatrix)
        .multiply(camera.matrixWorldInverse)
        .multiply(this.points.matrixWorld);
      const { min, max } = geometry.boundingBox;
      let left = Infinity,
        right = -Infinity,
        top = Infinity,
        bottom = -Infinity;
      let nearPlane = false;
      for (let slot = 0; slot < 8; slot++) {
        this.corner
          .set(
            slot & 1 ? max.x : min.x,
            slot & 2 ? max.y : min.y,
            slot & 4 ? max.z : min.z,
            1,
          )
          .applyMatrix4(this.matrix);
        if (this.corner.w <= 0 || this.corner.z < -this.corner.w) {
          nearPlane = true;
          break;
        }
        const x = this.corner.x / this.corner.w,
          y = this.corner.y / this.corner.w;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
      if (!nearPlane) {
        const projectedWidth = ((right - left) * width) / 2;
        const projectedHeight = ((bottom - top) * height) / 2;
        const area = Math.max(
          projectedWidth * projectedHeight,
          projectedWidth,
          projectedHeight,
          1,
        );
        const budget = Math.max(256, area / spacing ** 2);
        sampleFraction = Math.min(1, budget / eligiblePoints);
      }
    }
    this.fraction.value = sampleFraction;
    return {
      autoDensity,
      density,
      eligiblePoints,
      sampleFraction,
      estimatedDisplayedPoints: Math.round(eligiblePoints * sampleFraction),
      samplingMethod: sampleFraction < 1 ? "stable-sample" : "full",
      cellSizePx: null,
      maxScreenOffsetPx: 0,
    };
  }
}
