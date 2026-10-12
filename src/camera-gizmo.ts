import "./camera-gizmo.css";
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

export function cubeRegions(quaternion: THREE.Quaternion) {
  const inverse = quaternion.clone().invert();
  return faces
    .filter((f) => f.normal.clone().applyQuaternion(inverse).z > 1e-5)
    .flatMap((face) => {
      const a = face.vertices[0],
        u = face.vertices[1].clone().sub(a),
        v = face.vertices[3].clone().sub(a),
        cuts = [0, 0.18, 0.82, 1];
      return [0, 1, 2].flatMap((row) =>
        [0, 1, 2].map((col) => ({
          id: a
            .clone()
            .addScaledVector(u, col === 0 ? 0 : col === 2 ? 1 : 0.5)
            .addScaledVector(v, row === 0 ? 0 : row === 2 ? 1 : 0.5)
            .toArray()
            .map(Math.round)
            .join(","),
          points: [
            [cuts[col], cuts[row]],
            [cuts[col + 1], cuts[row]],
            [cuts[col + 1], cuts[row + 1]],
            [cuts[col], cuts[row + 1]],
          ].map(([x, y]) =>
            a
              .clone()
              .addScaledVector(u, x)
              .addScaledVector(v, y)
              .applyQuaternion(inverse),
          ),
        })),
      );
    });
}
export interface CubeActions {
  orient: (direction: THREE.Vector3, up: THREE.Vector3) => void;
}
/** CAD standard views use Z up on side faces, Y up on Top and -Y on Bottom. */
export function standardViewUp(direction: THREE.Vector3): THREE.Vector3 {
  return Math.abs(direction.clone().normalize().z) > 0.999
    ? new THREE.Vector3(0, direction.z > 0 ? 1 : -1, 0)
    : new THREE.Vector3(0, 0, 1);
}
export function adjacentViewPose(q: THREE.Quaternion, side: string) {
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  return {
    direction:
      side === "left"
        ? right.negate()
        : side === "right"
          ? right
          : side === "up"
            ? up
            : up.clone().negate(),
    up: side === "up" ? back.negate() : side === "down" ? back : up,
  };
}
export function cameraOrientation(direction: THREE.Vector3, up: THREE.Vector3) {
  const pose = new THREE.PerspectiveCamera();
  pose.position.copy(direction.clone().normalize());
  pose.up.copy(up);
  pose.lookAt(0, 0, 0);
  return pose.quaternion.clone();
}
export function applyViewTransition(
  camera: NavigationCamera,
  target: THREE.Vector3,
  from: THREE.Quaternion,
  to: THREE.Quaternion,
  distance: number,
  progress: number,
) {
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  camera.quaternion.slerpQuaternions(from, to, t * t * (3 - 2 * t));
  camera.position
    .copy(target)
    .add(new THREE.Vector3(0, 0, distance).applyQuaternion(camera.quaternion));
  camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  camera.updateMatrixWorld();
}
export class CameraGizmo {
  readonly element = document.createElement("div");
  private svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  private menu = document.createElement("div");
  private mode: Projection = "orthographic";
  private hovered?: string;
  private orientation = new THREE.Quaternion();
  private faceControls: HTMLButtonElement[] = [];
  private drag?: {
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    direction?: string;
    moved: boolean;
  };
  constructor(
    private onView: (view: ViewFace) => void,
    private onRotate: (dx: number, dy: number) => void,
    private onProjection: (projection: Projection) => void,
    onFit: () => void,
    private actions?: CubeActions,
  ) {
    this.element.className = "camera-gizmo";
    this.svg.setAttribute("viewBox", "0 0 132 132");
    this.svg.setAttribute(
      "aria-label",
      "View cube: click faces, edges or corners; drag to orbit",
    );
    this.svg.setAttribute("role", "group");
    this.svg.addEventListener("pointerdown", this.down);
    this.svg.addEventListener("pointermove", this.move);
    this.svg.addEventListener("pointerup", this.up);
    this.svg.addEventListener("pointercancel", () => (this.drag = undefined));
    this.svg.addEventListener("pointerleave", () => this.highlight());
    this.svg.addEventListener("keydown", (event) => {
      const id = (event.target as Element).closest<SVGElement>(
        "[data-direction]",
      )?.dataset.direction;
      if (id && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        this.orient(id);
      }
    });
    const home = document.createElement("button");
    home.className = "cube-home cube-control";
    home.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M2 11 12 2l10 9h-4v11h-5v-7h-2v7H6V11Z"/></svg>';
    home.setAttribute("aria-label", "Go Home");
    home.title = "Go Home";
    home.onclick = () => this.goHome();
    const toggle = document.createElement("button");
    toggle.className = "cube-menu-toggle cube-control";
    toggle.textContent = "▾";
    toggle.setAttribute("aria-label", "ViewCube settings");
    toggle.setAttribute("aria-expanded", "false");
    toggle.onclick = () => {
      this.menu.hidden = !this.menu.hidden;
      toggle.setAttribute("aria-expanded", String(!this.menu.hidden));
    };
    this.menu.className = "cube-menu";
    this.menu.hidden = true;
    const button = (
      label: string,
      action: () => void,
      parent: HTMLElement = this.menu,
    ) => {
      const item = document.createElement("button");
      item.textContent = label;
      item.onclick = () => {
        action();
        this.menu.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
      };
      parent.append(item);
      return item;
    };
    button("Go Home", () => this.goHome());
    for (const [label, mode] of [
      ["Orthographic", "orthographic"],
      ["Perspective", "perspective"],
    ] as const) {
      const item = button(label, () => {
        this.mode = mode;
        onProjection(mode === "orthographic" ? "orthographic" : "perspective");
        this.checks();
      });
      item.dataset.projection = mode;
      item.setAttribute("role", "menuitemradio");
    }
    button("Fit model in view", onFit);
    for (const [side, glyph] of [
      ["up", "▴"],
      ["down", "▾"],
      ["left", "◂"],
      ["right", "▸"],
      ["ccw", "↶"],
      ["cw", "↷"],
    ]) {
      const control = document.createElement("button");
      control.className = `cube-control cube-adjacent cube-${side}`;
      control.hidden = true;
      control.textContent = glyph;
      if (side === "cw" || side === "ccw") {
        const icon = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        icon.setAttribute("viewBox", "0 0 32 32");
        icon.setAttribute("aria-hidden", "true");
        const arrow = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        arrow.setAttribute(
          "d",
          side === "ccw"
            ? "M29 23C25 12 16 6 8 8L8 3L1 11L10 16L9 11C16 9 23 15 26 24Z"
            : "M4 3C16 5 24 13 23 23L28 22L23 31L16 23L21 24C22 16 15 8 3 6Z",
        );
        arrow.setAttribute("fill", "currentColor");
        icon.append(arrow);
        control.replaceChildren(icon);
      }
      control.setAttribute(
        "aria-label",
        side === "cw" || side === "ccw"
          ? `Rotate view 90 degrees ${side === "cw" ? "clockwise" : "counterclockwise"}`
          : `View adjacent ${side}`,
      );
      control.onclick = () => {
        if (side === "cw" || side === "ccw") {
          const back = new THREE.Vector3(0, 0, 1).applyQuaternion(
            this.orientation,
          );
          const up = new THREE.Vector3(0, 1, 0)
            .applyQuaternion(this.orientation)
            .applyAxisAngle(back, side === "cw" ? Math.PI / 2 : -Math.PI / 2);
          this.actions?.orient(back, up);
        } else {
          const pose = adjacentViewPose(this.orientation, side);
          this.actions?.orient(pose.direction, pose.up);
        }
      };
      this.faceControls.push(control);
    }
    this.element.append(
      this.svg,
      home,
      toggle,
      ...this.faceControls,
      this.menu,
    );
    document.addEventListener("pointerdown", this.outside);
    this.element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.menu.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
    });
    this.element.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (!this.menu.hidden && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        const items = Array.from(
          this.menu.querySelectorAll<HTMLElement>("button"),
        ).filter((item) => item.getClientRects().length);
        const index = items.indexOf(document.activeElement as HTMLElement);
        items[
          (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length
        ]?.focus();
      }
      if (event.key === "Escape") {
        this.menu.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
    this.checks();
  }
  private outside = (event: PointerEvent) => {
    if (!this.element.contains(event.target as Node)) {
      this.menu.hidden = true;
      this.element
        .querySelector(".cube-menu-toggle")
        ?.setAttribute("aria-expanded", "false");
    }
  };
  private checks() {
    for (const item of this.menu.querySelectorAll<HTMLElement>(
      "[data-projection]",
    ))
      item.setAttribute(
        "aria-checked",
        String(item.dataset.projection === this.mode),
      );
  }
  private goHome() {
    this.onView("iso");
  }
  update(camera: NavigationCamera): void {
    this.mode =
      camera instanceof THREE.OrthographicCamera
        ? "orthographic"
        : "perspective";
    this.checks();
    const q = camera.quaternion,
      ns = "http://www.w3.org/2000/svg";
    this.orientation.copy(q);
    const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const faceAligned =
      Math.max(
        Math.abs(direction.x),
        Math.abs(direction.y),
        Math.abs(direction.z),
      ) >
      1 - 1e-7;
    for (const control of this.faceControls) control.hidden = !faceAligned;
    const coords = (points: THREE.Vector3[]) =>
      points.map((p) => [66 + p.x * 27, 66 - p.y * 27].join(",")).join(" ");
    this.svg.replaceChildren();
    for (const face of projectCube(q)) {
      const polygon = document.createElementNS(ns, "polygon");
      polygon.setAttribute("points", coords(face.points));
      polygon.classList.add("cube-face");
      polygon.style.setProperty("--shade", String(0.55 + face.depth * 0.35));
      this.svg.append(polygon);
    }
    for (const region of cubeRegions(q)) {
      const polygon = document.createElementNS(ns, "polygon");
      polygon.setAttribute("points", coords(region.points));
      polygon.dataset.direction = region.id;
      polygon.classList.add("cube-target");
      polygon.setAttribute("tabindex", "0");
      polygon.setAttribute("role", "button");
      const label = region.id
        .split(",")
        .flatMap((n, i) =>
          Number(n)
            ? [
                i === 0
                  ? Number(n) > 0
                    ? "right"
                    : "left"
                  : i === 1
                    ? Number(n) > 0
                      ? "back"
                      : "front"
                    : Number(n) > 0
                      ? "top"
                      : "bottom",
              ]
            : [],
        )
        .join(" ");
      polygon.setAttribute("aria-label", label + " view");
      const selected =
        faceAligned &&
        new THREE.Vector3(
          ...(region.id.split(",").map(Number) as [number, number, number]),
        ).distanceTo(direction) < 1e-5;
      polygon.classList.toggle("cube-selected", selected);
      polygon.setAttribute("aria-pressed", String(selected));
      this.svg.append(polygon);
    }
    for (const face of projectCube(q)) {
      const text = document.createElementNS(ns, "text"),
        center = face.points
          .reduce((v, p) => v.add(p), new THREE.Vector3())
          .multiplyScalar(0.25);
      const u = face.points[1].clone().sub(face.points[0]).multiplyScalar(13.5),
        v = face.points[0].clone().sub(face.points[3]).multiplyScalar(13.5);
      text.setAttribute(
        "transform",
        [
          "matrix(",
          [u.x, -u.y, v.x, -v.y, 66 + center.x * 27, 66 - center.y * 27].join(
            ",",
          ),
          ")",
        ].join(""),
      );
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("y", ".12");
      text.setAttribute("font-size", ".36");
      text.classList.add("cube-label");
      text.textContent = face.view.toUpperCase();
      this.svg.append(text);
    }
    const inverse = q.clone().invert();
    for (const [name, axis, color] of [
      ["X", new THREE.Vector3(1, 0, 0), "#ed3038"],
      ["Y", new THREE.Vector3(0, 1, 0), "#28bd72"],
      ["Z", new THREE.Vector3(0, 0, 1), "#406bff"],
    ] as const) {
      const start = new THREE.Vector3(-1, -1, -1).applyQuaternion(inverse),
        end = new THREE.Vector3(-1, -1, -1)
          .addScaledVector(axis, 2.4)
          .applyQuaternion(inverse);
      if (end.z < start.z - 0.1) continue;
      const line = document.createElementNS(ns, "line");
      for (const [attr, value] of [
        ["x1", 66 + start.x * 27],
        ["y1", 66 - start.y * 27],
        ["x2", 66 + end.x * 27],
        ["y2", 66 - end.y * 27],
      ] as const)
        line.setAttribute(attr, String(value));
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", "2");
      line.setAttribute("pointer-events", "none");
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", String(66 + end.x * 27));
      text.setAttribute("y", String(70 - end.y * 27));
      text.setAttribute("fill", color);
      text.setAttribute("font-size", "13");
      text.setAttribute("pointer-events", "none");
      text.textContent = name;
      this.svg.append(line, text);
    }
    this.highlight(this.hovered);
  }
  private highlight(id?: string) {
    this.hovered = id;
    for (const target of this.svg.querySelectorAll<SVGElement>(
      "[data-direction]",
    ))
      target.classList.toggle(
        "cube-highlight",
        target.dataset.direction === id,
      );
  }
  private orient(id: string) {
    const vector = new THREE.Vector3(
      ...(id.split(",").map(Number) as [number, number, number]),
    );
    this.actions?.orient(vector, standardViewUp(vector));
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
      direction: (event.target as Element).closest<SVGElement>(
        "[data-direction]",
      )?.dataset.direction,
      moved: false,
    };
    this.svg.setPointerCapture(event.pointerId);
  };
  private move = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag) {
      this.highlight(
        (event.target as Element).closest<SVGElement>("[data-direction]")
          ?.dataset.direction,
      );
      return;
    }
    if (drag.id !== event.pointerId) return;
    if (
      !drag.moved &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3
    )
      return;
    drag.moved = true;
    this.highlight();
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
    if (!drag.moved && drag.direction) this.orient(drag.direction);
  };
  dispose(): void {
    document.removeEventListener("pointerdown", this.outside);
    this.element.remove();
  }
}
