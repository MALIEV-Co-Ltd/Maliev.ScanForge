import * as THREE from "three";
import type { InteractiveBoundsSource } from "./interactive-bounds-pool";
import type { InteractiveDisplayPose } from "./viewport-interactive-preview";
import {
  nativeInteractiveMirrorModelMatrix,
  nativeInteractiveMirrorPlane,
} from "./interactive-mirror-view";

/** GPU presentation sink for prepared native point lists. Pool/session ownership stays with its caller. */
export class InteractiveMirrorDisplay {
  readonly group = new THREE.Group();
  private readonly objects = new Map<
    string,
    THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  >();
  private disposed = false;
  private revision = 0;
  private preparedRevision = -1;
  private readonly uploadFrames = new Set<() => void>();
  private readonly compiling = new Map<THREE.PointsMaterial, number>();
  private readonly retired = new Set<THREE.PointsMaterial>();
  constructor(
    private readonly sources: ReadonlyMap<string, InteractiveBoundsSource>,
    private readonly invalidate: () => void,
  ) {
    this.group.name = "Interactive mirrored scans";
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
  }
  show(poses: readonly InteractiveDisplayPose[], plane: number) {
    if (this.disposed) throw new Error("Interactive mirror display is closed.");
    const reflection = nativeInteractiveMirrorPlane(plane),
      ids = new Set(poses.map((p) => p.entityId));
    if (!poses.length || ids.size !== poses.length)
      throw new Error(
        "Interactive mirror display requires distinct scan targets.",
      );
    // Prepare every small matrix and validate every source before changing the live display.
    const prepared = poses.map((p) => {
      const source = this.sources.get(p.entityId);
      if (
        !source ||
        source.positions.length % 3 ||
        !source.normals ||
        source.normals.length !== source.positions.length
      )
        throw new Error(
          "Interactive mirror target requires aligned source positions and normals.",
        );
      return {
        id: p.entityId,
        source,
        matrix: nativeInteractiveMirrorModelMatrix(p.matrix),
      };
    });
    for (const [id, object] of this.objects)
      if (!ids.has(id)) this.remove(id, object);
    for (const p of prepared) {
      let object = this.objects.get(p.id);
      if (!object) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(p.source.positions, 3),
        );
        geometry.setAttribute(
          "normal",
          new THREE.BufferAttribute(p.source.normals!, 3),
        );
        geometry.setIndex(
          new THREE.BufferAttribute(
            new Uint32Array(p.source.positions.length / 3),
            1,
          ).setUsage(THREE.DynamicDrawUsage),
        );
        geometry.setDrawRange(0, 0);
        // This is the application's point presentation style; native fixed-function lighting/pixel parity is separate.
        const material = new THREE.PointsMaterial({
          size: 2,
          sizeAttenuation: false,
          vertexColors: true,
          toneMapped: false,
        });
        object = new THREE.Points(geometry, material);
        object.name = p.id;
        object.matrixAutoUpdate = false;
        // Avoid an O(N) first-frame bounds scan. The session already owns measured bounds.
        object.frustumCulled = false;
        this.objects.set(p.id, object);
        this.group.add(object);
        this.revision++;
      }
      object.matrix.fromArray(p.matrix);
    }
    this.group.matrix.fromArray(reflection);
    this.group.visible = this.preparedRevision === this.revision;
    this.group.updateMatrixWorld(true);
    this.invalidate();
  }
  publish(
    entityId: string,
    prepared: { indices: Uint32Array; colors?: Float32Array },
  ) {
    if (this.disposed) throw new Error("Interactive mirror display is closed.");
    const object = this.objects.get(entityId);
    if (!object)
      throw new Error("Interactive mirror target is no longer displayed.");
    const geometry = object.geometry,
      index = geometry.index!,
      count = geometry.getAttribute("position").count;
    let color = geometry.getAttribute("color") as
      THREE.BufferAttribute | undefined;
    const { indices, colors } = prepared;
    // The shared pool produces ordered, validated index partitions; do not scan every point again on the main thread.
    if (
      !(indices instanceof Uint32Array) ||
      indices.length > count ||
      (indices.length && indices[indices.length - 1] >= count) ||
      (colors !== undefined &&
        (!(colors instanceof Float32Array) || colors.length !== count * 3)) ||
      (!color && !colors)
    )
      throw new Error(
        "Interactive mirror publication requires prepared indices and initial source colors.",
      );
    if (colors) {
      if (!color) {
        color = new THREE.BufferAttribute(colors, 3).setUsage(
          THREE.DynamicDrawUsage,
        );
        geometry.setAttribute("color", color);
        object.material.needsUpdate = true;
        this.revision++;
        this.group.visible = false;
      } else {
        color.array.set(colors);
        color.needsUpdate = true;
      }
    }
    index.array.set(indices);
    index.clearUpdateRanges();
    if (indices.length) {
      index.addUpdateRange(0, indices.length);
      index.needsUpdate = true;
    }
    geometry.setDrawRange(0, indices.length);
    this.invalidate();
  }
  /** Compile new point materials before revealing them; keep pose/index-only changes immediately drawable. */
  async prepare(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
  ): Promise<boolean> {
    if (this.disposed) throw new Error("Interactive mirror display is closed.");
    if (!this.objects.size) return false;
    if (this.preparedRevision === this.revision) return true;
    const revision = this.revision;
    const materials = [...this.objects.values()].map(
      (object) => object.material,
    );
    for (const material of materials)
      this.compiling.set(material, (this.compiling.get(material) ?? 0) + 1);
    try {
      await renderer.compileAsync(this.group, camera);
    } finally {
      for (const material of materials) {
        const pending = this.compiling.get(material)! - 1;
        if (pending) this.compiling.set(material, pending);
        else {
          this.compiling.delete(material);
          if (this.retired.delete(material)) material.dispose();
        }
      }
    }
    if (this.disposed || revision !== this.revision || !this.objects.size)
      return false;
    // Upload one scan per frame into a disposable 1px target. Do not clear the user's canvas
    // or batch every scan's first position/color/index upload into one long visible frame.
    const target = new THREE.WebGLRenderTarget(1, 1);
    target.texture.colorSpace = renderer.outputColorSpace;
    try {
      for (const object of [...this.objects.values()]) {
        await this.nextUploadFrame();
        if (this.disposed || revision !== this.revision) return false;
        const previous = renderer.getRenderTarget(),
          face = renderer.getActiveCubeFace(),
          level = renderer.getActiveMipmapLevel();
        const viewport = renderer.getViewport(new THREE.Vector4()),
          scissor = renderer.getScissor(new THREE.Vector4()),
          scissorTest = renderer.getScissorTest();
        const scratch = new THREE.Scene(),
          point = new THREE.Points(object.geometry, object.material);
        point.matrixAutoUpdate = false;
        point.frustumCulled = false;
        point.matrix.copy(object.matrixWorld);
        scratch.add(point);
        try {
          renderer.setRenderTarget(target);
          renderer.render(scratch, camera);
        } finally {
          renderer.setViewport(viewport);
          renderer.setScissor(scissor);
          renderer.setScissorTest(scissorTest);
          // Restore logical canvas defaults first. setRenderTarget then reinstates an
          // offscreen target's own physical viewport/scissor without overwriting them.
          renderer.setRenderTarget(previous, face, level);
          scratch.remove(point);
        }
      }
    } finally {
      target.dispose();
    }
    if (this.disposed || revision !== this.revision || !this.objects.size)
      return false;
    this.preparedRevision = revision;
    this.group.visible = true;
    this.invalidate();
    return true;
  }
  private nextUploadFrame() {
    return new Promise<void>((resolve) => {
      let frame: number | undefined;
      const finish = () => {
        clearTimeout(timer);
        if (frame !== undefined) cancelAnimationFrame(frame);
        this.uploadFrames.delete(finish);
        resolve();
      };
      const timer = setTimeout(
        finish,
        typeof requestAnimationFrame === "function" ? 32 : 0,
      );
      this.uploadFrames.add(finish);
      if (typeof requestAnimationFrame === "function")
        frame = requestAnimationFrame(finish);
    });
  }
  private remove(
    id: string,
    object: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>,
  ) {
    this.group.remove(object);
    object.geometry.dispose();
    // Three's compileAsync still polls material/program properties after its first task.
    // Release a removed material only once every active compiler has stopped reading it.
    if (this.compiling.has(object.material)) this.retired.add(object.material);
    else object.material.dispose();
    this.objects.delete(id);
    this.revision++;
  }
  clear() {
    for (const finish of this.uploadFrames) finish();
    if (!this.objects.size) return;
    for (const [id, object] of this.objects) this.remove(id, object);
    this.group.visible = false;
    this.invalidate();
  }
  dispose() {
    this.clear();
    this.disposed = true;
  }
}
