import * as THREE from "three";

export interface DeviationDisplay {
  distances: Float32Array;
  lower: number;
  upper: number;
}

/** Upload measured distances once; tolerance changes update only two uniforms. */
export function installDeviationHeatmap(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>,
  display: DeviationDisplay,
) {
  if (display.distances.length !== mesh.geometry.getAttribute("position").count)
    throw new Error("Deviation samples must match display vertices.");
  const data = new Float32Array(display.distances.length * 2);
  display.distances.forEach((distance, i) => {
    data[i * 2] = Number.isFinite(distance) ? distance : 0;
    data[i * 2 + 1] = Number.isFinite(distance) ? 1 : 0;
  });
  mesh.geometry.setAttribute(
    "deviationSample",
    new THREE.BufferAttribute(data, 2),
  );
  const lower = { value: display.lower },
    upper = { value: display.upper };
  mesh.material.onBeforeCompile = (shader) => {
    shader.uniforms.deviationLower = lower;
    shader.uniforms.deviationUpper = upper;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 deviationSample;\nvarying vec2 vDeviationSample;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvDeviationSample = deviationSample;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float deviationLower;\nuniform float deviationUpper;\nvarying vec2 vDeviationSample;",
      )
      .replace(
        "#include <color_fragment>",
        `
        float d = vDeviationSample.x;
        float limit = d < 0.0 ? max(abs(deviationLower), 1e-12) : max(deviationUpper, 1e-12);
        float t = clamp(2.0 + 2.0 * d / limit, 0.0, 4.0);
        vec3 ramp = t <= 1.0 ? vec3(0.0, t, 1.0) :
          t <= 2.0 ? vec3(0.0, 1.0, 2.0 - t) :
          t <= 3.0 ? vec3(t - 2.0, 1.0, 0.0) : vec3(1.0, 4.0 - t, 0.0);
        if (vDeviationSample.y < 0.999) ramp = vec3(50.0 / 255.0);
        diffuseColor.rgb *= sRGBTransferEOTF(vec4(ramp, 1.0)).rgb;
      `,
      );
  };
  mesh.material.customProgramCacheKey = () => "signed-deviation-tolerance-v1";
  mesh.material.needsUpdate = true;
  return (bounds: Pick<DeviationDisplay, "lower" | "upper">) => {
    lower.value = bounds.lower;
    upper.value = bounds.upper;
  };
}

export function deviationExtrema(
  positions: ArrayLike<number>,
  distances: ArrayLike<number>,
  hidden: readonly number[] = [],
) {
  const excluded = new Set(hidden);
  let minimum = -1,
    maximum = -1;
  for (let i = 0; i < distances.length; i++) {
    if (!Number.isFinite(distances[i]) || excluded.has(Math.floor(i / 3)))
      continue;
    if (minimum < 0 || distances[i] < distances[minimum]) minimum = i;
    if (maximum < 0 || distances[i] > distances[maximum]) maximum = i;
  }
  return [minimum, maximum].flatMap((index, i) =>
    index < 0
      ? []
      : [
          {
            label: i ? "Maximum" : "Minimum",
            value: distances[index],
            point: new THREE.Vector3(
              positions[index * 3],
              positions[index * 3 + 1],
              positions[index * 3 + 2],
            ),
          },
        ],
  );
}

export class DeviationCallouts {
  private root = document.createElement("div");
  private markers: { point: THREE.Vector3; element: HTMLDivElement }[];
  constructor(
    container: HTMLElement,
    points: ReturnType<typeof deviationExtrema>,
  ) {
    this.root.style.cssText =
      "position:absolute;inset:0;pointer-events:none;overflow:hidden";
    this.root.className = "deviation-callouts";
    this.markers = points.map(({ label, value, point }, index) => {
      const element = document.createElement("div");
      element.style.cssText = "position:absolute;width:0;height:0";
      const color = index ? "#ffbf38" : "#49c5ff";
      const direction = index ? 1 : -1;
      element.innerHTML = `<svg width="100" height="60" style="position:absolute;left:${direction > 0 ? 0 : -100}px;top:${index ? -60 : 0}px;overflow:visible"><path d="${index ? "M0 60 L32 18 L100 18" : "M100 0 L68 42 L0 42"}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
      const dot = document.createElement("span");
      dot.style.cssText = `position:absolute;width:7px;height:7px;border-radius:50%;background:${color};transform:translate(-50%,-50%)`;
      const text = document.createElement("span");
      text.setAttribute("role", "img");
      text.setAttribute("aria-label", `${label} deviation: ${value} mm`);
      text.textContent = `${label} ${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(3)} mm`;
      text.style.cssText = `position:absolute;white-space:nowrap;left:${index ? 32 : -32}px;top:${index ? -60 : 30}px;transform:${index ? "none" : "translateX(-100%)"};padding:4px 6px;background:#202020e8;color:${color};border:1px solid ${color};font:12px sans-serif`;
      element.append(dot, text);
      this.root.appendChild(element);
      return { point, element };
    });
    container.appendChild(this.root);
  }
  update(
    camera: THREE.Camera,
    width: number,
    height: number,
    planes: readonly THREE.Plane[] = [],
  ) {
    for (const { point, element } of this.markers) {
      const projected = point.clone().project(camera);
      element.hidden =
        Math.abs(projected.z) > 1 ||
        Math.abs(projected.x) > 1 ||
        Math.abs(projected.y) > 1 ||
        planes.some((plane) => plane.distanceToPoint(point) < 0);
      element.style.left = `${((projected.x + 1) * width) / 2}px`;
      element.style.top = `${((1 - projected.y) * height) / 2}px`;
    }
  }
  dispose() {
    this.root.remove();
  }
}
