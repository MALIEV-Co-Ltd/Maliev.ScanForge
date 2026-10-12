import * as THREE from "three";

export type Projection = "orthographic" | "perspective";
export type ViewFace =
  "iso" | "top" | "bottom" | "front" | "back" | "left" | "right";
export type NavigationCamera =
  THREE.PerspectiveCamera | THREE.OrthographicCamera;
const FOV = 42;

export function cameraAspect(camera: NavigationCamera): number {
  return camera instanceof THREE.PerspectiveCamera
    ? camera.aspect
    : (camera.right - camera.left) / (camera.top - camera.bottom);
}
export function resizeCamera(camera: NavigationCamera, aspect: number): void {
  if (camera instanceof THREE.PerspectiveCamera) camera.aspect = aspect;
  else {
    const half = (camera.top - camera.bottom) / 2;
    camera.left = -half * aspect;
    camera.right = half * aspect;
  }
  camera.updateProjectionMatrix();
}
/** Preserve the target-plane framing, pose and clipping range when switching projection. */
export function convertProjection(
  camera: NavigationCamera,
  target: THREE.Vector3,
  projection: Projection,
): NavigationCamera {
  const aspect = cameraAspect(camera);
  const distance = Math.max(camera.position.distanceTo(target), 1e-6);
  const half =
    camera instanceof THREE.PerspectiveCamera
      ? (distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) /
        camera.zoom
      : (camera.top - camera.bottom) / (2 * camera.zoom);
  const next =
    projection === "perspective"
      ? new THREE.PerspectiveCamera(FOV, aspect, camera.near, camera.far)
      : new THREE.OrthographicCamera(
          -half * aspect,
          half * aspect,
          half,
          -half,
          camera.near,
          camera.far,
        );
  next.position.copy(camera.position);
  if (next instanceof THREE.PerspectiveCamera)
    next.position
      .sub(target)
      .normalize()
      .multiplyScalar(half / Math.tan(THREE.MathUtils.degToRad(FOV) / 2))
      .add(target);
  next.quaternion.copy(camera.quaternion);
  next.up.copy(camera.up);
  next.updateProjectionMatrix();
  next.updateMatrixWorld();
  return next;
}
export function frameCamera(
  camera: NavigationCamera,
  radius: number,
  padding = 1.18,
): number {
  const aspect = cameraAspect(camera);
  const vertical =
    THREE.MathUtils.degToRad(
      camera instanceof THREE.PerspectiveCamera ? camera.fov : FOV,
    ) / 2;
  const distance =
    (radius /
      Math.sin(Math.min(vertical, Math.atan(Math.tan(vertical) * aspect)))) *
    padding;
  if (camera instanceof THREE.OrthographicCamera) {
    const half = (radius * padding) / Math.min(1, aspect);
    camera.top = half;
    camera.bottom = -half;
    camera.left = -half * aspect;
    camera.right = half * aspect;
    camera.zoom = 1;
  }
  return distance;
}
/** Trackball-like camera-space drag, preserving orbit center and distance. */
export function rotateCamera(
  camera: NavigationCamera,
  target: THREE.Vector3,
  dx: number,
  dy: number,
): void {
  const rotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-dy * 0.008, -dx * 0.008, 0, "YXZ"),
  );
  const world = camera.quaternion
    .clone()
    .multiply(rotation)
    .multiply(camera.quaternion.clone().invert());
  camera.position.sub(target).applyQuaternion(world).add(target);
  camera.up.applyQuaternion(world).normalize();
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

const faces: {
  view: ViewFace;
  normal: THREE.Vector3;
  vertices: THREE.Vector3[];
}[] = [
  {
    view: "right",
    normal: new THREE.Vector3(1, 0, 0),
    vertices: [
      [1, -1, -1],
      [1, 1, -1],
      [1, 1, 1],
      [1, -1, 1],
    ].map((v) => new THREE.Vector3(...(v as [number, number, number]))),
  },
  {
    view: "left",
    normal: new THREE.Vector3(-1, 0, 0),
    vertices: [
      [-1, 1, -1],
      [-1, -1, -1],
      [-1, -1, 1],
      [-1, 1, 1],
    ].map((v) => new THREE.Vector3(...(v as [number, number, number]))),
  },
  {
    view: "back",
    normal: new THREE.Vector3(0, 1, 0),
    vertices: [
      [1, 1, -1],
      [-1, 1, -1],
      [-1, 1, 1],
      [1, 1, 1],
    ].map((v) => new THREE.Vector3(...(v as [number, number, number]))),
  },
  {
    view: "front",
    normal: new THREE.Vector3(0, -1, 0),
    vertices: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, -1, 1],
      [-1, -1, 1],
    ].map((v) => new THREE.Vector3(...(v as [number, number, number]))),
  },
  {
    view: "top",
    normal: new THREE.Vector3(0, 0, 1),
    vertices: [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ].map((v) => new THREE.Vector3(...(v as [number, number, number]))),
  },
  {
    view: "bottom",
    normal: new THREE.Vector3(0, 0, -1),
    vertices: [
      [-1, 1, -1],
      [1, 1, -1],
      [1, -1, -1],
      [-1, -1, -1],
    ].map((v) => new THREE.Vector3(...(v as [number, number, number]))),
  },
];
export function projectCube(quaternion: THREE.Quaternion) {
  const inverse = quaternion.clone().invert();
  return faces
    .map((face) => ({
      view: face.view,
      depth: face.normal.clone().applyQuaternion(inverse).z,
      points: face.vertices.map((v) => v.clone().applyQuaternion(inverse)),
    }))
    .filter((face) => face.depth > 1e-5)
    .sort((a, b) => a.depth - b.depth);
}

/** SVG cube uses the same camera pose as the scene; no second WebGL context. */
export class CameraGizmo {
  readonly element = document.createElement("div");
  private readonly svg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  private readonly select = document.createElement("select");
  private drag?: {
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    view?: ViewFace;
    moved: boolean;
  };
  constructor(
    private readonly onView: (view: ViewFace) => void,
    private readonly onRotate: (dx: number, dy: number) => void,
    onProjection: (projection: Projection) => void,
    onFit: () => void,
  ) {
    this.element.className = "camera-gizmo";
    this.element.style.cssText =
      "position:absolute;right:12px;top:10px;width:132px;display:flex;flex-direction:column;align-items:center;gap:4px;z-index:3;color:var(--text);user-select:none";
    this.svg.setAttribute("viewBox", "0 0 132 112");
    this.svg.setAttribute(
      "aria-label",
      "View cube: click a face to orient, drag to orbit",
    );
    this.svg.setAttribute("role", "group");
    this.svg.style.cssText =
      "width:132px;height:112px;touch-action:none;cursor:grab";
    this.svg.addEventListener("pointerdown", this.down);
    this.svg.addEventListener("pointermove", this.move);
    this.svg.addEventListener("pointerup", this.up);
    this.svg.addEventListener("pointercancel", this.cancel);
    this.svg.addEventListener("keydown", this.key);
    this.select.setAttribute("aria-label", "Camera projection");
    this.select.style.cssText =
      "font:inherit;font-size:11px;color:inherit;background:var(--panel, #272727);border:1px solid var(--border, #555);border-radius:4px;padding:4px;width:132px";
    for (const projection of ["orthographic", "perspective"] as const) {
      const option = document.createElement("option");
      option.value = projection;
      option.textContent = projection[0].toUpperCase() + projection.slice(1);
      this.select.append(option);
    }
    this.select.addEventListener("change", () =>
      onProjection(this.select.value as Projection),
    );
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:4px";
    for (const [label, action] of [
      ["Isometric", () => onView("iso")],
      ["Fit", onFit],
    ] as const) {
      const button = document.createElement("button");
      button.textContent = label;
      button.style.cssText =
        "font:inherit;font-size:10px;color:inherit;background:var(--panel, #272727);border:1px solid var(--border, #555);border-radius:4px;padding:3px 6px";
      button.addEventListener("click", action);
      actions.append(button);
    }
    this.element.append(this.svg, this.select, actions);
  }
  update(camera: NavigationCamera): void {
    this.select.value =
      camera instanceof THREE.OrthographicCamera
        ? "orthographic"
        : "perspective";
    this.svg.replaceChildren();
    for (const face of projectCube(camera.quaternion)) {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.dataset.view = face.view;
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      group.setAttribute("aria-label", `${face.view} view`);
      const polygon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "polygon",
      );
      polygon.setAttribute(
        "points",
        face.points.map((p) => `${66 + p.x * 28},${56 - p.y * 28}`).join(" "),
      );
      const shade = Math.round(95 + face.depth * 95);
      polygon.setAttribute("fill", `rgb(${shade},${shade},${shade})`);
      polygon.setAttribute("stroke", "#dedede");
      polygon.setAttribute("stroke-width", "1");
      const text = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text",
      );
      const center = face.points
        .reduce((v, p) => v.add(p), new THREE.Vector3())
        .multiplyScalar(0.25);
      text.setAttribute("x", String(66 + center.x * 28));
      text.setAttribute("y", String(60 - center.y * 28));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("fill", "#171717");
      text.setAttribute("font-size", "9");
      text.setAttribute("font-family", "system-ui");
      text.setAttribute("font-weight", "700");
      text.setAttribute("pointer-events", "none");
      text.textContent = face.view.toUpperCase();
      group.append(polygon, text);
      this.svg.append(group);
    }
  }
  private down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      view: (event.target as Element).closest<SVGGElement>("[data-view]")
        ?.dataset.view as ViewFace | undefined,
      moved: false,
    };
    this.svg.setPointerCapture(event.pointerId);
  };
  private move = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    if (
      !drag.moved &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3
    )
      return;
    drag.moved = true;
    this.onRotate(event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX;
    drag.y = event.clientY;
  };
  private up = (event: PointerEvent) => {
    if (!this.drag || this.drag.id !== event.pointerId) return;
    this.move(event);
    const drag = this.drag;
    this.drag = undefined;
    if (this.svg.hasPointerCapture(event.pointerId))
      this.svg.releasePointerCapture(event.pointerId);
    if (!drag.moved && drag.view) this.onView(drag.view);
  };
  private cancel = () => {
    this.drag = undefined;
  };
  private key = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const view = (event.target as Element).closest<SVGGElement>("[data-view]")
      ?.dataset.view as ViewFace | undefined;
    if (view) {
      event.preventDefault();
      this.onView(view);
    }
  };
  dispose(): void {
    this.svg.removeEventListener("pointerdown", this.down);
    this.svg.removeEventListener("pointermove", this.move);
    this.svg.removeEventListener("pointerup", this.up);
    this.svg.removeEventListener("pointercancel", this.cancel);
    this.svg.removeEventListener("keydown", this.key);
    this.element.remove();
  }
}
