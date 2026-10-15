import * as THREE from "three";
export interface InteractiveDisplayPose {
  entityId: string;
  matrix: readonly number[];
}
/** Imperative shared display sink: no buffers, tessellation, normals or selection indices change. */
export class InteractivePosePreview {
  private saved = new Map<
    string,
    { object: THREE.Object3D; matrix: THREE.Matrix4; auto: boolean }
  >();
  constructor(
    private readonly objects: ReadonlyMap<string, THREE.Object3D>,
    private readonly invalidate: () => void,
  ) {}
  show(poses: readonly InteractiveDisplayPose[]) {
    const ids = new Set(poses.map((p) => p.entityId));
    if (
      ids.size !== poses.length ||
      !poses.length ||
      poses.some(
        (p) =>
          !this.objects.has(p.entityId) ||
          p.matrix.length !== 12 ||
          !p.matrix.every(Number.isFinite),
      )
    )
      throw new Error(
        "Interactive display requires distinct existing targets and finite poses.",
      );
    for (const [id, saved] of this.saved)
      if (!ids.has(id) || this.objects.get(id) !== saved.object)
        throw new Error(
          "Interactive display targets changed; cancel before replacing them.",
        );
    for (const p of poses) {
      const object = this.objects.get(p.entityId)!;
      if (!this.saved.has(p.entityId)) {
        if (object.matrixAutoUpdate) object.updateMatrix();
        this.saved.set(p.entityId, {
          object,
          matrix: object.matrix.clone(),
          auto: object.matrixAutoUpdate,
        });
      }
      const m = p.matrix;
      object.matrixAutoUpdate = false;
      object.matrix.set(
        m[0],
        m[1],
        m[2],
        m[3],
        m[4],
        m[5],
        m[6],
        m[7],
        m[8],
        m[9],
        m[10],
        m[11],
        0,
        0,
        0,
        1,
      );
      object.updateMatrixWorld(true);
    }
    this.invalidate();
  }
  clear() {
    if (!this.saved.size) return;
    for (const saved of this.saved.values()) {
      saved.object.matrix.copy(saved.matrix);
      saved.object.matrixAutoUpdate = saved.auto;
      saved.object.updateMatrixWorld(true);
    }
    this.saved.clear();
    this.invalidate();
  }
  get active() {
    return this.saved.size > 0;
  }
}
