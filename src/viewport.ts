import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Entity, Vec3 } from "./types";

type Item = {
  positions: number[];
  color: string;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
};

/** A Z-up, millimetre scene. Rendering runs only while the scene or camera changes. */
export class Viewport {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100000);
  private readonly renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
  });
  private readonly controls: OrbitControls;
  private readonly observer: ResizeObserver;
  private readonly objects = new Map<string, Item>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly section = new THREE.Group();
  private readonly measurement = new THREE.Group();
  private readonly clippingPlane = new THREE.Plane();
  private readonly triad = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  private readonly axes: {
    vector: THREE.Vector3;
    line: SVGLineElement;
    label: SVGTextElement;
  }[] = [];
  private selectedId: string | null = null;
  private grid: THREE.GridHelper;
  private disposed = false;
  private frame: number | null = null;
  private wireframe = false;
  private clipping = false;
  private pointer: { x: number; y: number; id: number; moved: boolean } | null =
    null;
  private bounds = new THREE.Box3();
  private extent = 100;

  constructor(
    private readonly container: HTMLElement,
    private readonly onPick: (point: Vec3, entityId: string) => void,
    private readonly onSelect: (id: string) => void,
  ) {
    this.scene.background = new THREE.Color("#e9eef2");
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(160, -200, 140);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.touchAction = "none";
    container.appendChild(this.renderer.domElement);
    this.triad.setAttribute("viewBox", "0 0 100 90");
    this.triad.setAttribute("role", "img");
    this.triad.setAttribute("aria-label", "World axes: X red, Y green, Z blue");
    this.triad.style.cssText =
      "position:absolute;left:12px;bottom:12px;width:100px;height:90px;pointer-events:none";
    for (const [name, color, vector] of [
      ["X", "#da6351", new THREE.Vector3(1, 0, 0)],
      ["Y", "#29976d", new THREE.Vector3(0, 1, 0)],
      ["Z", "#327ccc", new THREE.Vector3(0, 0, 1)],
    ] as const) {
      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      line.setAttribute("x1", "45");
      line.setAttribute("y1", "45");
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", "2.5");
      line.setAttribute("stroke-linecap", "round");
      const label = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text",
      );
      label.textContent = name;
      label.setAttribute("fill", color);
      label.setAttribute("font-size", "12");
      label.setAttribute("font-family", "system-ui, sans-serif");
      label.setAttribute("font-weight", "700");
      label.setAttribute("text-anchor", "middle");
      this.axes.push({ vector, line, label });
      this.triad.append(line, label);
    }
    container.appendChild(this.triad);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener("change", this.invalidate);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7d86, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(120, -140, 220);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xd8eeff, 1.4);
    fill.position.set(-120, 80, 50);
    this.scene.add(fill);
    this.grid = new THREE.GridHelper(400, 20, "#a7b6bd", "#d0dadf");
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid, this.section, this.measurement);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.addEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.addEventListener(
      "pointercancel",
      this.pointerCancel,
    );
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(container);
    this.resize();
  }

  private invalidate = (): void => {
    if (!this.disposed && this.frame === null)
      this.frame = requestAnimationFrame(this.render);
  };

  private render = (): void => {
    this.frame = null;
    if (this.disposed) return;
    const moving = this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const inverse = this.camera.quaternion.clone().invert();
    for (const axis of this.axes) {
      const projected = axis.vector.clone().applyQuaternion(inverse);
      const x = 45 + projected.x * 29;
      const y = 45 - projected.y * 29;
      axis.line.setAttribute("x2", String(x));
      axis.line.setAttribute("y2", String(y));
      axis.label.setAttribute(
        "x",
        String(
          45 +
            projected.x * 40 +
            (Math.hypot(projected.x, projected.y) < 0.1 ? 9 : 0),
        ),
      );
      axis.label.setAttribute("y", String(49 - projected.y * 40));
    }
    if (moving) this.invalidate();
  };

  private resize = (): void => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  };

  private pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary) return;
    this.pointer = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      moved: false,
    };
  };

  private pointerMove = (event: PointerEvent): void => {
    if (
      this.pointer?.id === event.pointerId &&
      Math.hypot(
        event.clientX - this.pointer.x,
        event.clientY - this.pointer.y,
      ) > 4
    ) {
      this.pointer.moved = true;
    }
  };

  private pointerCancel = (): void => {
    this.pointer = null;
  };

  private pointerUp = (event: PointerEvent): void => {
    const pointer = this.pointer;
    this.pointer = null;
    if (
      !pointer ||
      pointer.id !== event.pointerId ||
      pointer.moved ||
      Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 4
    )
      return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const candidates = [...this.objects.values()]
      .filter((item) => item.mesh.visible)
      .map((item) => item.mesh);
    const hit = this.raycaster
      .intersectObjects(candidates, false)
      .find(
        (candidate) =>
          !this.clipping ||
          this.clippingPlane.distanceToPoint(candidate.point) >= 0,
      );
    if (!hit) return;
    const id = hit.object.userData.entityId as string;
    this.onSelect(id);
    this.onPick([hit.point.x, hit.point.y, hit.point.z], id);
  };

  setEntities(entities: Entity[], selectedId: string | null): void {
    if (selectedId !== this.selectedId) this.clearDeviations();
    this.selectedId = selectedId;
    const ids = new Set(entities.map((entity) => entity.id));
    for (const [id, item] of this.objects) {
      if (!ids.has(id)) {
        this.scene.remove(item.mesh);
        item.mesh.geometry.dispose();
        item.mesh.material.dispose();
        this.objects.delete(id);
      }
    }
    this.bounds.makeEmpty();
    for (const entity of entities) {
      let item = this.objects.get(entity.id);
      if (!item) {
        const material = new THREE.MeshStandardMaterial({
          color: entity.color,
          roughness: 0.55,
          metalness: 0.12,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
        mesh.userData.entityId = entity.id;
        item = { positions: [], color: entity.color, mesh };
        this.objects.set(entity.id, item);
        this.scene.add(mesh);
      }
      if (item.positions !== entity.positions) {
        item.mesh.geometry.dispose();
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(entity.positions, 3),
        );
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        item.mesh.geometry = geometry;
        item.positions = entity.positions;
        item.mesh.material.vertexColors = false;
      }
      item.mesh.visible = entity.visible;
      item.color = entity.color;
      const material = item.mesh.material;
      material.color.set(material.vertexColors ? "#ffffff" : entity.color);
      material.emissive.set(entity.id === selectedId ? "#17677b" : "#000000");
      material.emissiveIntensity = entity.id === selectedId ? 0.28 : 0;
      material.opacity = Math.max(0, Math.min(1, entity.opacity));
      material.transparent = material.opacity < 1;
      material.depthWrite = material.opacity >= 1;
      material.wireframe = this.wireframe;
      material.clippingPlanes = this.clipping ? [this.clippingPlane] : [];
      material.needsUpdate = true;
      if (
        entity.visible &&
        item.mesh.geometry.boundingBox &&
        entity.positions.length > 0
      ) {
        this.bounds.union(item.mesh.geometry.boundingBox);
      }
    }
    if (!this.bounds.isEmpty()) {
      this.extent = Math.max(
        this.bounds.getSize(new THREE.Vector3()).length(),
        0.01,
      );
      const center = this.bounds.getCenter(new THREE.Vector3());
      this.grid.position.set(
        center.x,
        center.y,
        this.bounds.min.z - this.extent * 0.002,
      );
      this.grid.scale.setScalar(this.extent / 100);
    }
    this.invalidate();
  }

  fitView(): void {
    const center = this.bounds.isEmpty()
      ? new THREE.Vector3()
      : this.bounds.getCenter(new THREE.Vector3());
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    if (direction.lengthSq() === 0) direction.set(1, -1, 0.8).normalize();
    const radius = this.extent / 2;
    const vertical = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * this.camera.aspect);
    const distance = (radius / Math.sin(Math.min(vertical, horizontal))) * 1.18;
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.near = Math.max(distance / 10000, 0.00001);
    this.camera.far = Math.max(distance * 100, this.extent * 100);
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = this.extent * 0.0001;
    this.controls.maxDistance = distance * 20;
    this.controls.update();
    this.invalidate();
  }

  setView(view: "iso" | "top" | "front" | "right"): void {
    const direction =
      view === "top"
        ? new THREE.Vector3(0, -0.00001, 1)
        : view === "front"
          ? new THREE.Vector3(0, -1, 0)
          : view === "right"
            ? new THREE.Vector3(1, 0, 0)
            : new THREE.Vector3(1, -1, 0.8);
    this.camera.position
      .copy(this.controls.target)
      .add(direction.normalize().multiplyScalar(this.extent * 2));
    this.fitView();
  }

  setWireframe(enabled: boolean): void {
    this.wireframe = enabled;
    for (const item of this.objects.values())
      item.mesh.material.wireframe = enabled;
    this.invalidate();
  }

  setSection(axis: "x" | "y" | "z", offset: number, enabled: boolean): void {
    this.clipping = enabled;
    this.clippingPlane.normal.set(
      axis === "x" ? -1 : 0,
      axis === "y" ? -1 : 0,
      axis === "z" ? -1 : 0,
    );
    this.clippingPlane.constant = offset;
    for (const item of this.objects.values()) {
      item.mesh.material.clippingPlanes = enabled ? [this.clippingPlane] : [];
      item.mesh.material.needsUpdate = true;
    }
    this.section.visible = enabled;
    this.invalidate();
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      const renderable = child as THREE.Mesh;
      renderable.geometry?.dispose();
      if (Array.isArray(renderable.material))
        renderable.material.forEach((material) => material.dispose());
      else renderable.material?.dispose();
    }
  }

  setSectionLines(segments: number[]): void {
    this.clearGroup(this.section);
    if (segments.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(segments, 3),
      );
      this.section.add(
        new THREE.LineSegments(
          geometry,
          new THREE.LineBasicMaterial({ color: "#ed8a30", depthTest: false }),
        ),
      );
    }
    this.invalidate();
  }

  setMeasurement(points: Vec3[]): void {
    this.clearGroup(this.measurement);
    if (points.length > 1) {
      const geometry = new THREE.BufferGeometry().setFromPoints(
        points.map((point) => new THREE.Vector3(...point)),
      );
      this.measurement.add(
        new THREE.Line(
          geometry,
          new THREE.LineBasicMaterial({ color: "#dc4a6b", depthTest: false }),
        ),
      );
    }
    for (const point of points) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(this.extent * 0.005, 12, 8),
        new THREE.MeshBasicMaterial({ color: "#dc4a6b", depthTest: false }),
      );
      marker.position.set(...point);
      marker.renderOrder = 10;
      this.measurement.add(marker);
    }
    this.invalidate();
  }

  private clearDeviations(): void {
    for (const item of this.objects.values()) {
      if (!item.mesh.material.vertexColors) continue;
      item.mesh.geometry.deleteAttribute("color");
      item.mesh.material.vertexColors = false;
      item.mesh.material.color.set(item.color);
      item.mesh.material.needsUpdate = true;
    }
  }

  setDeviation(
    entityId: string,
    values: number[] | null,
    tolerance: number,
  ): void {
    this.clearDeviations();
    const item = this.objects.get(entityId);
    if (!item) {
      this.invalidate();
      return;
    }
    const count = item.mesh.geometry.getAttribute("position").count;
    if (values && values.length === count) {
      const colors = new Float32Array(count * 3);
      const color = new THREE.Color();
      const negative = new THREE.Color("#2479de");
      const zero = new THREE.Color("#4bb78c");
      const positive = new THREE.Color("#e56b47");
      const limit = Math.max(Math.abs(tolerance), 0.000001);
      for (let i = 0; i < count; i++) {
        const signed = Number.isFinite(values[i])
          ? Math.max(-1, Math.min(1, values[i] / limit))
          : 0;
        color
          .copy(zero)
          .lerp(signed < 0 ? negative : positive, Math.abs(signed));
        color.toArray(colors, i * 3);
      }
      item.mesh.geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(colors, 3),
      );
      item.mesh.material.vertexColors = true;
      item.mesh.material.color.set("#ffffff");
    } else {
      item.mesh.geometry.deleteAttribute("color");
      item.mesh.material.vertexColors = false;
      item.mesh.material.color.set(item.color);
    }
    item.mesh.material.needsUpdate = true;
    this.invalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.removeEventListener("change", this.invalidate);
    this.controls.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.pointerDown);
    canvas.removeEventListener("pointermove", this.pointerMove);
    canvas.removeEventListener("pointerup", this.pointerUp);
    canvas.removeEventListener("pointercancel", this.pointerCancel);
    for (const item of this.objects.values()) {
      item.mesh.geometry.dispose();
      item.mesh.material.dispose();
    }
    this.objects.clear();
    this.clearGroup(this.section);
    this.clearGroup(this.measurement);
    this.grid.geometry.dispose();
    if (Array.isArray(this.grid.material))
      this.grid.material.forEach((material) => material.dispose());
    else this.grid.material.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
    this.triad.remove();
  }
}
