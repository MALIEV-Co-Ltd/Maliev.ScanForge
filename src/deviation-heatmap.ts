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
  private footprint: THREE.Box3[];
  private container: HTMLElement;
  private markers: { point: THREE.Vector3; element: HTMLDivElement }[];
  constructor(
    container: HTMLElement,
    points: ReturnType<typeof deviationExtrema>,
    positions: ArrayLike<number>,
  ) {
    this.container = container;
    this.footprint = meshFootprint(positions);
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
    const bounds = this.footprint.map((box) =>
      projectedModelBounds(box, camera, width, height),
    );
    const origin = this.container.getBoundingClientRect();
    const occupied: ScreenRect[] = Array.from(
      (
        this.container.closest(".workspace") ?? this.container
      ).querySelectorAll<HTMLElement>(
        ".command-host, .deviation-legend, .viewport-tools-container, .camera-gizmo, .scan-quick-tools",
      ),
    )
      .filter((node) => !node.hidden && node.getClientRects().length > 0)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          x: rect.left - origin.left,
          y: rect.top - origin.top,
          width: rect.width,
          height: rect.height,
        };
      });
    for (const { point, element } of this.markers) {
      const projected = point.clone().project(camera);
      element.hidden =
        Math.abs(projected.z) > 1 ||
        Math.abs(projected.x) > 1 ||
        Math.abs(projected.y) > 1 ||
        planes.some((plane) => plane.distanceToPoint(point) < 0);
      element.style.left = `${((projected.x + 1) * width) / 2}px`;
      element.style.top = `${((1 - projected.y) * height) / 2}px`;
      if (element.hidden) continue;
      const text = element.lastElementChild as HTMLSpanElement;
      const size = text.getBoundingClientRect();
      const anchor = {
        x: ((projected.x + 1) * width) / 2,
        y: ((1 - projected.y) * height) / 2,
      };
      const rect = placeDeviationLabel(
        bounds,
        anchor,
        size.width,
        size.height,
        width,
        height,
        occupied,
      );
      if (!rect) {
        element.hidden = true;
        continue;
      }
      occupied.push(rect);
      text.style.left = `${rect.x - anchor.x}px`;
      text.style.top = `${rect.y - anchor.y}px`;
      text.style.transform = "none";
      const svg = element.firstElementChild as SVGSVGElement;
      svg.style.left = "0";
      svg.style.top = "0";
      const endX =
        Math.max(rect.x, Math.min(anchor.x, rect.x + rect.width)) - anchor.x;
      const endY =
        Math.max(rect.y, Math.min(anchor.y, rect.y + rect.height)) - anchor.y;
      svg.querySelector("path")!.setAttribute("d", `M0 0 L${endX} ${endY}`);
    }
  }
  dispose() {
    this.root.remove();
  }
}

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function projectedModelBounds(
  box: THREE.Box3,
  camera: THREE.Camera,
  width: number,
  height: number,
): ScreenRect {
  const projected = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(x, y, z).project(camera);
        // A box crossing the camera plane has no finite screen bounds.
        if (p.z < -1 || p.z > 1) return { x: 0, y: 0, width, height };
        projected.push({
          x: ((p.x + 1) * width) / 2,
          y: ((1 - p.y) * height) / 2,
        });
      }
  const x = Math.min(...projected.map((p) => p.x)),
    y = Math.min(...projected.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...projected.map((p) => p.x)) - x,
    height: Math.max(...projected.map((p) => p.y)) - y,
  };
}
/** Group complete triangles into bounded spatial cells once. Their projected
 * boxes conservatively cover the surface, including concave meshes, without
 * re-projecting millions of scan vertices on every camera update. */
export function meshFootprint(positions: ArrayLike<number>): THREE.Box3[] {
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let i = 0; i < positions.length; i += 3)
    bounds.expandByPoint(
      point.set(positions[i], positions[i + 1], positions[i + 2]),
    );
  const extent = bounds.getSize(new THREE.Vector3());
  const cell = Math.max(extent.x, extent.y, extent.z) / 32 || 1;
  const cells = new Map<number, THREE.Box3>();
  for (let i = 0; i + 8 < positions.length; i += 9) {
    let key = 0;
    for (let axis = 0; axis < 3; axis++)
      key +=
        Math.floor(
          ((positions[i + axis] +
            positions[i + 3 + axis] +
            positions[i + 6 + axis]) /
            3 -
            bounds.min.getComponent(axis)) /
            cell,
        ) *
        64 ** axis;
    let box = cells.get(key);
    if (!box) cells.set(key, (box = new THREE.Box3()));
    for (let j = 0; j < 9; j += 3)
      box.expandByPoint(
        point.set(positions[i + j], positions[i + j + 1], positions[i + j + 2]),
      );
  }
  return [...cells.values()];
}

export function placeDeviationLabel(
  model: ScreenRect | readonly ScreenRect[],
  anchor: { x: number; y: number },
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  occupied: ScreenRect[] = [],
): ScreenRect | undefined {
  const margin = 12,
    step = 8,
    gap = 10;
  if (
    width + 2 * margin > viewportWidth ||
    height + 2 * margin > viewportHeight
  )
    return;
  const cols = Math.ceil(viewportWidth / step),
    rows = Math.ceil(viewportHeight / step);
  const blocked = new Uint8Array(cols * rows);
  for (const rect of [
    ...(Array.isArray(model) ? model : [model as ScreenRect]),
    ...occupied,
  ]) {
    const left = Math.max(0, Math.floor((rect.x - gap) / step));
    const right = Math.min(cols, Math.ceil((rect.x + rect.width + gap) / step));
    const top = Math.max(0, Math.floor((rect.y - gap) / step));
    const bottom = Math.min(
      rows,
      Math.ceil((rect.y + rect.height + gap) / step),
    );
    if (right <= left || bottom <= top) continue;
    for (let y = top; y < bottom; y++)
      blocked.fill(1, y * cols + left, y * cols + right);
  }
  // Integral occupancy makes each candidate's overlap check constant time.
  const stride = cols + 1,
    sums = new Uint32Array(stride * (rows + 1));
  for (let y = 0; y < rows; y++) {
    let rowSum = 0;
    for (let x = 0; x < cols; x++) {
      rowSum += blocked[y * cols + x];
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + rowSum;
    }
  }
  let best: ScreenRect | undefined,
    score = Infinity;
  for (let y = margin; y + height <= viewportHeight - margin; y += step)
    for (let x = margin; x + width <= viewportWidth - margin; x += step) {
      const left = Math.floor(x / step),
        right = Math.ceil((x + width) / step);
      const top = Math.floor(y / step),
        bottom = Math.ceil((y + height) / step);
      if (
        sums[bottom * stride + right] -
        sums[top * stride + right] -
        sums[bottom * stride + left] +
        sums[top * stride + left]
      )
        continue;
      const dx = Math.max(x, Math.min(anchor.x, x + width)) - anchor.x;
      const dy = Math.max(y, Math.min(anchor.y, y + height)) - anchor.y;
      const distance = dx * dx + dy * dy;
      // Prefer a short diagonal attachment over a rigid axial leader when
      // distances are similar; never force labels into distant corners.
      const candidate =
        distance +
        (Math.abs(dx) < 8 || Math.abs(dy) < 8 ? 144 : 0) +
        0.001 *
          ((x + width / 2 - anchor.x) ** 2 + (y + height / 2 - anchor.y) ** 2);
      if (candidate < score) {
        score = candidate;
        best = { x, y, width, height };
      }
    }
  return best;
}
