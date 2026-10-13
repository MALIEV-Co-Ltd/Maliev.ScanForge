import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { installSelectionBoundaryAttributes } from "./selection-boundary-highlight";

/** A uniformly pulsing boundary with a steady translucent selection interior. */
export class SelectionProcessingHighlight {
  private readonly active = { value: false };
  private readonly time = { value: 0 };
  private reducedMotion = false;
  private readonly outlines = new Set<LineSegments2>();

  private updateOutlines() {
    const pulse = this.reducedMotion
      ? 0.5
      : 0.5 + 0.5 * Math.cos(this.time.value * 3.0);
    for (const line of this.outlines) {
      line.visible = this.active.value;
      const { width, opacity } = line.userData;
      line.material.linewidth = width;
      line.material.opacity = opacity * (0.5 + 0.5 * pulse);
    }
  }

  setActive(active: boolean, reducedMotion = false) {
    this.active.value = active;
    this.reducedMotion = reducedMotion;
    if (!active || reducedMotion) this.time.value = 0;
    this.updateOutlines();
  }

  update(seconds: number): boolean {
    if (!this.active.value || this.reducedMotion) return false;
    this.time.value = seconds;
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
            diffuseColor.a *= 0.38;
          }
        `,
        );
    };
    material.customProgramCacheKey = () =>
      `selection-processing-red-v5:${hasBoundary}`;
    return lines;
  }
}
