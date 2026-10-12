import * as THREE from "three";
import type { Vec3 } from "./types";

export interface ScanClipBounds {
  min: Vec3;
  max: Vec3;
}
export function scanClipPlanes(bounds: ScanClipBounds): THREE.Plane[] {
  for (let axis = 0; axis < 3; axis++)
    if (
      !Number.isFinite(bounds.min[axis]) ||
      !Number.isFinite(bounds.max[axis]) ||
      bounds.min[axis] > bounds.max[axis]
    )
      throw new Error("Clipping limits must be finite and ordered.");
  return [0, 1, 2].flatMap((axis) => {
    const direction = new THREE.Vector3().setComponent(axis, 1);
    return [
      new THREE.Plane(direction, -bounds.min[axis]),
      new THREE.Plane(direction.clone().negate(), bounds.max[axis]),
    ];
  });
}

/** Six draggable face handles. Owns only its helper geometry and pointer listeners. */
export class ScanClipBox {
  readonly group = new THREE.Group();
  private full?: ScanClipBounds;
  private bounds?: ScanClipBounds;
  private drag?: {
    pointer: number;
    axis: number;
    side: "min" | "max";
    plane: THREE.Plane;
    start: THREE.Vector3;
    value: number;
  };
  private ray = new THREE.Raycaster();
  private navigationWasEnabled = true;
  constructor(
    private canvas: HTMLElement,
    private camera: () => THREE.Camera,
    private navigation: { enabled: boolean },
    private update: (bounds: ScanClipBounds) => void,
  ) {
    this.group.name = "Mesh clipping box";
    canvas.addEventListener("pointerdown", this.down, true);
    canvas.addEventListener("pointermove", this.move, true);
    canvas.addEventListener("pointerup", this.up, true);
    canvas.addEventListener("pointercancel", this.up, true);
  }
  set(bounds: ScanClipBounds | null, full?: ScanClipBounds) {
    this.clear();
    this.bounds = bounds ?? undefined;
    this.full = full ?? bounds ?? undefined;
    if (!bounds) {
      this.endDrag();
      return;
    }
    scanClipPlanes(bounds);
    const box = new THREE.Box3(
      new THREE.Vector3(...bounds.min),
      new THREE.Vector3(...bounds.max),
    );
    const helper = new THREE.Box3Helper(box, 0xd9b45c);
    (helper.material as THREE.LineBasicMaterial).depthTest = false;
    helper.renderOrder = 20;
    this.group.add(helper);
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.max(
      box.getSize(new THREE.Vector3()).length() * 0.022,
      0.001,
    );
    for (let axis = 0; axis < 3; axis++)
      for (const side of ["min", "max"] as const) {
        const handle = new THREE.Mesh(
          new THREE.BoxGeometry(size, size, size),
          new THREE.MeshBasicMaterial({ color: 0xe7c373, depthTest: false }),
        );
        handle.position.copy(center).setComponent(axis, bounds[side][axis]);
        handle.userData = { axis, side };
        handle.renderOrder = 21;
        this.group.add(handle);
      }
  }
  private cast(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera(),
    );
  }
  private down = (event: PointerEvent) => {
    if (event.button !== 0 || !this.bounds) return;
    this.cast(event);
    this.group.updateMatrixWorld(true);
    const hit = this.ray.intersectObjects(
      this.group.children.filter((item) => item instanceof THREE.Mesh),
    )[0];
    if (!hit) return;
    const { axis, side } = hit.object.userData as {
      axis: number;
      side: "min" | "max";
    };
    const direction = new THREE.Vector3().setComponent(axis, 1);
    const normal = this.camera().getWorldDirection(new THREE.Vector3());
    normal.addScaledVector(direction, -normal.dot(direction));
    if (normal.lengthSq() < 1e-10) return;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal.normalize(),
      hit.point,
    );
    const start = this.ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!start) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.drag = {
      pointer: event.pointerId,
      axis,
      side,
      plane,
      start,
      value: this.bounds[side][axis],
    };
    this.navigationWasEnabled = this.navigation.enabled;
    this.navigation.enabled = false;
    this.canvas.setPointerCapture(event.pointerId);
  };
  private move = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || !this.bounds || !this.full || event.pointerId !== drag.pointer)
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.cast(event);
    const point = this.ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (!point) return;
    const next = {
      min: [...this.bounds.min] as Vec3,
      max: [...this.bounds.max] as Vec3,
    };
    const value =
      drag.value +
      point.getComponent(drag.axis) -
      drag.start.getComponent(drag.axis);
    next[drag.side][drag.axis] = Math.max(
      this.full.min[drag.axis],
      Math.min(
        this.full.max[drag.axis],
        drag.side === "min"
          ? Math.min(value, next.max[drag.axis])
          : Math.max(value, next.min[drag.axis]),
      ),
    );
    this.update(next);
  };
  private up = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointer) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.endDrag();
  };
  private endDrag() {
    if (!this.drag) return;
    if (this.canvas.hasPointerCapture(this.drag.pointer))
      this.canvas.releasePointerCapture(this.drag.pointer);
    this.drag = undefined;
    this.navigation.enabled = this.navigationWasEnabled;
  }
  private clear() {
    for (const item of [...this.group.children]) {
      this.group.remove(item);
      const renderable = item as THREE.Mesh;
      renderable.geometry.dispose();
      if (Array.isArray(renderable.material))
        renderable.material.forEach((material) => material.dispose());
      else renderable.material.dispose();
    }
  }
  dispose() {
    this.endDrag();
    this.clear();
    for (const [name, handler] of [
      ["pointerdown", this.down],
      ["pointermove", this.move],
      ["pointerup", this.up],
      ["pointercancel", this.up],
    ] as const)
      this.canvas.removeEventListener(name, handler, true);
  }
}
