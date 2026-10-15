import * as THREE from "three";
import type { NavigationCamera } from "./camera-gizmo";
import type { InteractiveAlignmentState } from "./interactive-alignment-session";

const colors = [0xe85c5c, 0x65bd77, 0x609fea];
/** Display-only handles. Their IDs and world axes match the recovered drag controller. */
export class InteractiveAlignmentGizmo {
  readonly group = new THREE.Group();
  private readonly targets: THREE.Mesh[] = [];
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.MeshBasicMaterial>();
  private readonly ray = new THREE.Raycaster();
  private hovered?: number;
  private disposed = false;
  constructor() {
    this.group.name = "Interactive alignment handles";
    this.group.visible = false;
    const material = (color: number, opacity = 1) => {
      const m = new THREE.MeshBasicMaterial({
        color,
        opacity,
        transparent: opacity < 1,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.materials.add(m);
      return m;
    };
    const add = (
      geometry: THREE.BufferGeometry,
      m: THREE.MeshBasicMaterial,
      handle: number,
    ) => {
      const mesh = new THREE.Mesh(geometry, m);
      mesh.userData.interactiveHandle = handle;
      mesh.userData.baseOpacity = m.opacity;
      mesh.renderOrder = 1000;
      this.geometries.add(geometry);
      this.targets.push(mesh);
      this.group.add(mesh);
      return mesh;
    };
    for (let axis = 0; axis < 3; axis++) {
      const direction = new THREE.Vector3().setComponent(axis, 1);
      const orientation = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction,
      );
      const stem = add(
        new THREE.CylinderGeometry(0.018, 0.018, 0.78, 6),
        material(colors[axis]),
        axis + 4,
      );
      stem.quaternion.copy(orientation);
      stem.position.copy(direction).multiplyScalar(0.5);
      const tip = add(
        new THREE.ConeGeometry(0.08, 0.21, 12),
        material(colors[axis]),
        axis + 4,
      );
      tip.quaternion.copy(orientation);
      tip.position.copy(direction).multiplyScalar(0.99);
      const ring = add(
        new THREE.TorusGeometry(0.8, 0.018, 6, 64),
        material(colors[axis], 0.85),
        axis + 10,
      );
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
      const plane = add(
        new THREE.PlaneGeometry(0.22, 0.22),
        material(colors[axis], 0.22),
        axis + 1,
      );
      plane.quaternion.copy(ring.quaternion);
      for (let a = 0; a < 3; a++)
        if (a !== axis) plane.position.setComponent(a, 0.25);
    }
  }
  show(state: Pick<InteractiveAlignmentState, "pivot"> | null): void {
    if (this.disposed) return;
    this.group.visible = !!state;
    if (state)
      this.group.position.set(
        ...(state.pivot.map(Math.fround) as [number, number, number]),
      );
    else this.highlight(undefined);
  }
  update(camera: NavigationCamera, height: number): void {
    if (!this.group.visible || this.disposed) return;
    const span =
      camera instanceof THREE.OrthographicCamera
        ? (camera.top - camera.bottom) / camera.zoom
        : (2 *
            Math.abs(
              this.group.position
                .clone()
                .sub(camera.position)
                .dot(camera.getWorldDirection(new THREE.Vector3())),
            ) *
            Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) /
          camera.zoom;
    this.group.scale.setScalar(
      Math.max(Number.EPSILON, (span * 85) / Math.max(1, height)),
    );
    this.group.updateMatrixWorld(true);
  }
  pick(
    camera: NavigationCamera,
    point: readonly [number, number],
  ): number | undefined {
    if (!this.group.visible || this.disposed) return;
    this.ray.setFromCamera(
      new THREE.Vector2(point[0] * 2 - 1, 1 - point[1] * 2),
      camera,
    );
    return this.ray.intersectObjects(this.targets, false)[0]?.object.userData
      .interactiveHandle as number | undefined;
  }
  highlight(handle: number | undefined): boolean {
    if (this.hovered === handle) return false;
    this.hovered = handle;
    for (const target of this.targets) {
      const m = target.material as THREE.MeshBasicMaterial;
      m.opacity =
        target.userData.interactiveHandle === handle
          ? 1
          : target.userData.baseOpacity;
      m.color.setHex(
        target.userData.interactiveHandle === handle
          ? 0xffd36a
          : colors[
              target.userData.interactiveHandle >= 10
                ? target.userData.interactiveHandle - 10
                : target.userData.interactiveHandle >= 4
                  ? target.userData.interactiveHandle - 4
                  : target.userData.interactiveHandle - 1
            ],
      );
    }
    return true;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.group.clear();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.targets.length = 0;
  }
}
