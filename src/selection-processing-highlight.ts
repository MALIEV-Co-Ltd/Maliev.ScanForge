import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { installSelectionBoundaryAttributes } from "./selection-boundary-highlight";
import type { SelectionProcessingMode } from "./selection-processing-mode";

/** Center-out selection ripple and fine wireframe for every processing action. */
export class SelectionProcessingHighlight {
  private readonly active = { value: false };
  private readonly time = { value: 0 };
  private reducedMotion = false;
  private readonly motionEnabled = { value: true };
  private startedAt: number | undefined;
  private readonly outlines = new Set<LineSegments2>();

  private updateOutlines() {
    for (const line of this.outlines) {
      line.visible = this.active.value;
      const { width, opacity } = line.userData;
      line.material.linewidth = width;
      line.material.opacity = opacity * 0.65;
    }
  }

  setActive(
    active: boolean,
    reducedMotion = false,
    // Retained for existing adapters; all operations now share the same ripple.
    _mode: SelectionProcessingMode = "smoothing",
  ) {
    if (active !== this.active.value) {
      this.startedAt = undefined;
      this.time.value = 0;
    }
    this.active.value = active;
    this.motionEnabled.value = !reducedMotion;
    this.reducedMotion = reducedMotion;
    if (!active || reducedMotion) this.time.value = 0;
    this.updateOutlines();
  }

  update(seconds: number): boolean {
    if (!this.active.value || this.reducedMotion) return false;
    this.startedAt ??= seconds;
    this.time.value = seconds - this.startedAt;
    this.updateOutlines();
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
    // Anchor the ripple on the selected surface, rather than inside a curved mesh.
    const positions = geometry.getAttribute("position");
    const point = new THREE.Vector3();
    let nearest = Infinity;
    const surfaceCenter = center.clone();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i);
      const distance = point.distanceToSquared(center);
      if (distance < nearest) {
        nearest = distance;
        surfaceCenter.copy(point);
      }
    }
    let radius = 0;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i);
      radius = Math.max(radius, point.distanceTo(surfaceCenter));
    }
    center.copy(surfaceCenter);
    const hasBoundary = material instanceof THREE.MeshBasicMaterial;
    const segments = hasBoundary
      ? installSelectionBoundaryAttributes(geometry)
      : [];
    const lines: LineSegments2[] = [];
    if (segments.length) {
      for (const [width, opacity, color] of [
        [2.25, 0.85, "#dc4658"],
      ] as const) {
        const lineGeometry = new LineSegmentsGeometry().setPositions(segments);
        const lineMaterial = new LineMaterial({
          color,
          linewidth: width,
          opacity,
          transparent: true,
          blending: THREE.NormalBlending,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          toneMapped: false,
        });
        const line = new LineSegments2(lineGeometry, lineMaterial);
        line.userData = { width, opacity };
        line.renderOrder = 10 + lines.length;
        this.outlines.add(line);
        lineMaterial.addEventListener("dispose", () =>
          this.outlines.delete(line),
        );
        lines.push(line);
      }
      this.updateOutlines();
    }
    const boundaryVaryings = hasBoundary
      ? "\nvarying vec3 selectionBarycentric;"
      : "";
    material.onBeforeCompile = (shader) => {
      shader.uniforms.selectionProcessing = this.active;
      shader.uniforms.selectionProcessingTime = this.time;
      shader.uniforms.selectionMotionEnabled = this.motionEnabled;
      shader.uniforms.selectionRadius = {
        value: Math.max(radius / scale, 0.000001),
      };
      shader.uniforms.selectionCenter = { value: center };
      shader.uniforms.selectionScale = { value: scale };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 selectionPosition;\nuniform vec3 selectionCenter;\nuniform float selectionScale;" +
            boundaryVaryings +
            (hasBoundary ? "\nattribute float processingBarycentric;" : ""),
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nselectionPosition = (position - selectionCenter) / selectionScale;" +
            (hasBoundary
              ? "\nselectionBarycentric = vec3(1.0 - step(0.5, processingBarycentric), step(0.5, processingBarycentric) - step(1.5, processingBarycentric), step(1.5, processingBarycentric));"
              : ""),
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 selectionPosition;\nuniform bool selectionProcessing;\nuniform float selectionProcessingTime;\nuniform bool selectionMotionEnabled;\nuniform float selectionRadius;" +
            boundaryVaryings,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          if (selectionProcessing) {
              float radius = length(selectionPosition) / selectionRadius;
              float travel = fract(selectionProcessingTime / 1.8) * 1.4 - 0.2;
              float wave = exp(-pow((radius - travel) / 0.18, 2.0));
              wave *= smoothstep(-0.2, 0.05, travel) * (1.0 - smoothstep(0.95, 1.2, travel));
              if (!selectionMotionEnabled) wave = 0.4;
              float wireVisibility = wave;
              diffuseColor.a = opacity * (0.14 + 0.48 * wave);
            float wire = 0.0;
              ${
                hasBoundary
                  ? `vec3 edgeDistance = selectionBarycentric / max(fwidth(selectionBarycentric), vec3(0.0001));
              wire = 1.0 - smoothstep(0.15, 0.65, min(edgeDistance.x, min(edgeDistance.y, edgeDistance.z)));`
                  : ""
              }
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018, 0.023, 0.030), wire);
            diffuseColor.a = mix(diffuseColor.a, opacity * 0.95 * wireVisibility, wire);
          }
        `,
        );
    };
    material.customProgramCacheKey = () =>
      `selection-processing-red-v11:${hasBoundary}`;
    return lines;
  }
}
