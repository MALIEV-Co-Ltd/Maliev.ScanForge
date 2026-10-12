import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { updateCameraClipping } from "./camera-clipping";
import { createViewportGrid, renderSceneWithGrid } from "./viewport-grid";
import type { Entity, Positions, Vec3 } from "./types";
import type { Motion6D } from "./spacemouse";
import { cameraMouseButtons, subtractSelection } from "./mouse-input";
import type { ScreenRegion } from "./screen-selection";
import { AsyncScreenSelectionIndex } from "./screen-selection-client";
import {
  CameraGizmo,
  convertProjection,
  frameCamera,
  resizeCamera,
  rotateCamera,
  type NavigationCamera,
  type Projection,
} from "./camera-gizmo";
import {
  navigateCamera,
  configureNavigationSensitivity,
} from "./camera-navigation";
import { coordinateSketchFrame, sketchWorldPoint } from "./sketch-frame";
import { sampleSketchArc, type Sketch } from "./sketch";
import {
  drawSketchLine,
  drawSketchCircle,
  drawThreePointCurve,
  previewSketchCurve,
  moveSketchEndpoint,
  type SketchDrawingTool,
  type SketchUV,
} from "./sketch-drawing";

type Item = {
  hidden?: number[];
  triangleSlots?: number[];
  selectionIndex?: AsyncScreenSelectionIndex;
  positions: Positions;
  color: string;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
};

/** A Z-up, millimetre scene. Rendering runs only while the scene or camera changes. */
export class Viewport {
  onSelectionStatus?: (status: "pending" | "complete") => void;
  private readonly scene = new THREE.Scene();
  private camera: NavigationCamera = new THREE.OrthographicCamera(
    -100,
    100,
    100,
    -100,
    0.01,
    100000,
  );
  private readonly gizmo: CameraGizmo;
  private selectionGeneration = 0;
  private readonly renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
  });
  private readonly controls: TrackballControls;
  private readonly observer: ResizeObserver;
  private readonly objects = new Map<string, Item>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly section = new THREE.Group();
  private readonly measurement = new THREE.Group();
  private readonly triangleSelection = new THREE.Group();
  private readonly sketchGeometry = new THREE.Group();
  private readonly sketchPreview = new THREE.Group();
  private sketchEditor?: {
    sketch: Sketch;
    tool: SketchDrawingTool;
    constraints: boolean;
    showControlPoints?: boolean;
    onChange: (sketch: Sketch) => void;
    onError: (message: string) => void;
  };
  private sketchDrag?: {
    id: number;
    start: SketchUV;
    end: SketchUV;
    pointId?: string;
    tolerance: number;
  };
  private sketchCurvePoints: SketchUV[] = [];
  private sketchCurveHover?: SketchUV;
  private readonly landmarkOverlay = document.createElement("div");
  private landmarkLabels: { point: Vec3; element: HTMLSpanElement }[] = [];
  private brushing = false;
  private selectionTool: "brush" | "rectangle" | "circle" | "wand" = "brush";
  private brushPixels = 24;
  private selectThrough = false;
  private subtract = false;
  private readonly selectionOverlay = document.createElement("div");
  private readonly paintOverlay = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  private readonly paintTrail = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  private readonly paintCursor = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "circle",
  );
  private brushPath: [number, number][] = [];
  private readonly clippingPlane = new THREE.Plane();
  private selectedId: string | null = null;
  private pickTargetId: string | null = null;
  private grid: THREE.GridHelper;
  private readonly gridScene = new THREE.Scene();
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
    private readonly onSelection?: (
      id: string,
      mask: Uint8Array,
      remove: boolean,
    ) => void,
    private readonly onBrushScale?: (factor: number) => void,
    private readonly onSelectionError?: (message: string) => void,
    private readonly onContext?: (x: number, y: number) => void,
    private readonly onSelectionGesture?: (
      phase: "begin" | "end",
      x?: number,
      y?: number,
    ) => void,
    private readonly onEditScan?: (id: string) => void,
  ) {
    this.pointerDown = this.pointerDown.bind(this);
    this.pointerMove = this.pointerMove.bind(this);
    this.pointerUp = this.pointerUp.bind(this);
    this.pointerCancel = this.pointerCancel.bind(this);
    this.sketchKeyDown = this.sketchKeyDown.bind(this);
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
    this.landmarkOverlay.style.cssText =
      "position:absolute;inset:0;pointer-events:none;overflow:hidden";
    container.appendChild(this.landmarkOverlay);
    this.controls = new TrackballControls(
      this.camera,
      this.renderer.domElement,
    );
    Object.assign(
      this.controls.mouseButtons,
      cameraMouseButtons(false, { ctrlKey: false, shiftKey: false }),
    );
    this.controls.staticMoving = true;
    this.controls.keys = ["", "", ""];
    this.controls.minZoom = 0.000001;
    this.controls.maxZoom = 1000000;
    this.controls.addEventListener("change", this.invalidate);
    this.controls.addEventListener("start", this.invalidate);
    this.gizmo = new CameraGizmo(
      (view) => this.setView(view),
      (dx, dy) => {
        rotateCamera(this.camera, this.controls.target, dx, dy);
        this.controls.update();
        this.invalidate();
      },
      (projection) => this.setProjection(projection),
      () => this.fitView(),
    );
    container.append(this.gizmo.element);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(120, -140, 220);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 1.4);
    fill.position.set(-120, 80, 50);
    this.scene.add(fill);
    this.grid = createViewportGrid();
    this.gridScene.add(this.grid);
    this.scene.add(
      this.section,
      this.measurement,
      this.triangleSelection,
      this.sketchGeometry,
      this.sketchPreview,
    );
    this.selectionOverlay.className = "screen-selection-overlay";
    this.selectionOverlay.hidden = true;
    container.appendChild(this.selectionOverlay);
    this.paintOverlay.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;display:none";
    this.paintOverlay.setAttribute("aria-hidden", "true");
    // Composite the opaque fill, stroke and cursor before applying transparency.
    // Per-shape opacity would darken their overlaps during a closed-loop stroke.
    this.paintOverlay.setAttribute("opacity", "0.65");
    this.paintTrail.setAttribute("fill", "#c83244");
    this.paintTrail.setAttribute("fill-rule", "evenodd");
    this.paintTrail.setAttribute("stroke", "#c83244");
    this.paintTrail.setAttribute("stroke-linecap", "round");
    this.paintTrail.setAttribute("stroke-linejoin", "round");
    this.paintCursor.setAttribute("fill", "#c83244");
    this.paintOverlay.append(this.paintTrail, this.paintCursor);
    container.appendChild(this.paintOverlay);
    this.renderer.domElement.addEventListener("dblclick", this.doubleClick);
    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.pointerDown,
      true,
    );
    this.renderer.domElement.addEventListener("wheel", this.selectionWheel, {
      capture: true,
      passive: false,
    });
    this.renderer.domElement.addEventListener("contextmenu", this.contextMenu);
    this.renderer.domElement.addEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.addEventListener(
      "pointerleave",
      this.pointerLeave,
    );
    window.addEventListener("keydown", this.sketchKeyDown);
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

  setTheme(theme: "light" | "dark"): void {
    this.scene.background = new THREE.Color(
      theme === "dark" ? "#1c1c1c" : "#f4f5f6",
    );
    const color = this.grid.geometry.getAttribute("color");
    const major = new THREE.Color(theme === "dark" ? "#454545" : "#c3c8ce");
    const minor = new THREE.Color(theme === "dark" ? "#303030" : "#e0e3e6");
    for (let i = 0; i < color.count; i++) {
      const value = Math.floor(i / 4) === 10 ? major : minor;
      color.setXYZ(i, value.r, value.g, value.b);
    }
    color.needsUpdate = true;
    this.invalidate();
  }

  navigate(motion: Motion6D, seconds: number): void {
    if (this.disposed) return;
    navigateCamera(this.camera, this.controls.target, motion, seconds);
    this.controls.update();
    this.invalidate();
  }

  private render = (): void => {
    this.frame = null;
    if (this.disposed) return;
    this.controls.update();
    renderSceneWithGrid(
      this.renderer,
      this.scene,
      this.gridScene,
      this.camera,
      this.bounds,
    );
    for (const marker of this.landmarkLabels) {
      const projected = new THREE.Vector3(...marker.point).project(this.camera);
      marker.element.hidden = projected.z < -1 || projected.z > 1;
      marker.element.style.left = `${((projected.x + 1) * this.container.clientWidth) / 2}px`;
      marker.element.style.top = `${((1 - projected.y) * this.container.clientHeight) / 2}px`;
    }
    this.gizmo?.update(this.camera);
  };

  private resize = (): void => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    resizeCamera(this.camera, width / height);
    this.controls.handleResize();
    configureNavigationSensitivity(this.camera, this.controls, width, height);
    this.invalidate();
  };

  private pointerDown(event: PointerEvent): void {
    Object.assign(
      this.controls.mouseButtons,
      cameraMouseButtons(this.brushing, event),
    );
    if (this.beginSketchDrag(event)) return;
    if (!this.brushing || event.button === 1) {
      const bounds = this.renderer.domElement.getBoundingClientRect();
      configureNavigationSensitivity(
        this.camera,
        this.controls,
        bounds.width,
        bounds.height,
      );
    }
    if (event.button !== 0 || !event.isPrimary) return;
    this.pointer = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      moved: false,
    };
    if (this.brushing) {
      this.selectionGeneration++;
      for (const item of this.objects?.values() ?? [])
        item.selectionIndex?.cancel();
      this.onSelectionStatus?.("complete");
    }
    if (this.brushing && this.selectionTool !== "wand")
      this.onSelectionGesture?.("begin");
    if (this.brushing && this.selectionTool === "brush") {
      this.brushPath = [];
      this.renderer.domElement.setPointerCapture(event.pointerId);
      this.paintScreen(event);
    }
  }

  private pointerMove(event: PointerEvent): void {
    if (
      !this.brushing ||
      (event.buttons & 4) !== 0 ||
      event.pointerType === "touch"
    )
      this.invalidate();
    if (this.brushing && this.selectionTool === "brush")
      this.drawPaintStroke(event);
    if (this.sketchDrag?.id === event.pointerId) {
      const hit = this.sketchPlanePoint(event.clientX, event.clientY);
      if (hit) {
        this.sketchDrag.end = hit;
        this.renderSketchDrag();
      }
      return;
    }
    if (this.sketchCurvePoints.length && this.sketchEditor) {
      this.sketchCurveHover =
        this.sketchPlanePoint(event.clientX, event.clientY) ?? undefined;
      this.renderSketchDrag();
    }
    if (
      this.brushing &&
      this.pointer?.id === event.pointerId &&
      this.selectionTool === "brush"
    ) {
      const samples = event.getCoalescedEvents?.() ?? [];
      for (const sample of samples.length ? samples : [event])
        this.brushPath.push(this.screenPoint(sample.clientX, sample.clientY));
      const endpoint = this.screenPoint(event.clientX, event.clientY);
      const last = this.brushPath[this.brushPath.length - 1];
      if (!last || last[0] !== endpoint[0] || last[1] !== endpoint[1])
        this.brushPath.push(endpoint);
      this.drawPaintStroke(event);
    }
    if (
      this.brushing &&
      this.pointer?.id === event.pointerId &&
      (this.selectionTool === "rectangle" || this.selectionTool === "circle")
    )
      this.drawSelectionRegion(event);
    if (
      this.pointer?.id === event.pointerId &&
      Math.hypot(
        event.clientX - this.pointer.x,
        event.clientY - this.pointer.y,
      ) > 4
    ) {
      this.pointer.moved = true;
    }
  }

  private pointerCancel(): void {
    this.cancelSketchDrag();
    if (this.pointer && this.brushing) this.onSelectionGesture?.("end");
    this.pointer = null;
    this.brushPath = [];
    this.paintTrail.setAttribute("d", "");
    this.selectionOverlay.hidden = true;
  }

  private pointerLeave = (): void => {
    if (!this.pointer) this.paintOverlay.style.display = "none";
  };

  private pointerUp(event: PointerEvent): void {
    if (this.sketchDrag?.id === event.pointerId && this.sketchEditor) {
      const drag = this.sketchDrag,
        editor = this.sketchEditor;
      const end =
        this.sketchPlanePoint(event.clientX, event.clientY) ?? drag.end;
      const threePoint = editor.tool === "circle3" || editor.tool === "arc3";
      this.cancelSketchDrag(!threePoint);
      try {
        if (threePoint) {
          this.sketchCurvePoints.push(end);
          this.sketchCurveHover = undefined;
          if (this.sketchCurvePoints.length < 3) {
            this.renderSketchDrag();
            return;
          }
          const picked = [...this.sketchCurvePoints] as [
            SketchUV,
            SketchUV,
            SketchUV,
          ];
          this.cancelSketchDrag();
          editor.onChange(
            drawThreePointCurve(
              editor.sketch,
              picked,
              editor.tool as "circle3" | "arc3",
            ),
          );
          return;
        }
        editor.onChange(
          drag.pointId
            ? moveSketchEndpoint(editor.sketch, drag.pointId, end)
            : editor.tool === "circle"
              ? drawSketchCircle(editor.sketch, drag.start, end)
              : drawSketchLine(
                  editor.sketch,
                  drag.start,
                  end,
                  drag.tolerance,
                  editor.constraints,
                ),
        );
      } catch (error) {
        editor.onError(
          error instanceof Error ? error.message : "Sketch drawing failed.",
        );
      }
      return;
    }
    const pointer = this.pointer;
    this.pointer = null;
    if (
      !pointer ||
      pointer.id !== event.pointerId ||
      (!this.brushing &&
        (pointer.moved ||
          Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 4))
    )
      return;
    this.selectionOverlay.hidden = true;
    if (this.brushing) {
      if (this.selectionTool === "brush") this.paintScreen(event, true);
      else if (this.selectionTool === "wand") this.pickAt(event);
      else
        this.applyScreenRegion(event, {
          kind: this.selectionTool,
          start: this.screenPoint(pointer.x, pointer.y),
          end: this.screenPoint(event.clientX, event.clientY),
        });
    } else this.pickAt(event);
    if (this.brushing)
      this.onSelectionGesture?.("end", event.clientX, event.clientY);
    this.brushPath = [];
    this.paintTrail.setAttribute("d", "");
    if (this.renderer.domElement.hasPointerCapture(event.pointerId))
      this.renderer.domElement.releasePointerCapture(event.pointerId);
  }
  private contextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    if (this.sketchDrag || this.sketchCurvePoints.length) {
      this.cancelSketchDrag();
      return;
    }
    const [x, y] = this.screenPoint(event.clientX, event.clientY);
    this.onContext?.(x, y);
  };
  async visibleSelection(id: string, mask: Uint8Array): Promise<Uint8Array> {
    const item = this.objects.get(id);
    if (!item) return new Uint8Array(mask.length);
    item.selectionIndex ??= new AsyncScreenSelectionIndex(
      item.positions,
      item.hidden,
    );
    const rect = this.renderer.domElement.getBoundingClientRect();
    const visible = await item.selectionIndex.select(
      this.camera,
      { kind: "rectangle", start: [0, 0], end: [rect.width, rect.height] },
      { width: rect.width, height: rect.height, through: false },
    );
    return Uint8Array.from(mask, (value, i) => (value && visible[i] ? 1 : 0));
  }
  setSketchEditor(editor?: typeof this.sketchEditor): void {
    this.cancelSketchDrag();
    this.sketchEditor = editor;
    this.clearGroup(this.sketchGeometry);
    if (editor) {
      const sketch = editor.sketch;
      const frame = sketch.frame ?? coordinateSketchFrame("OXY", 0);
      const world = (uv: SketchUV) => sketchWorldPoint(frame, uv);
      try {
        for (const point of sketch.points) world([point.x, point.y]);
      } catch (error) {
        this.sketchEditor = { ...editor, tool: "navigate" };
        editor.onError(
          error instanceof Error
            ? error.message
            : "Invalid sketch coordinates.",
        );
        this.invalidate();
        return;
      }
      const lines: number[] = [];
      for (const segment of sketch.segments) {
        const a = sketch.points.find((p) => p.id === segment.a),
          b = sketch.points.find((p) => p.id === segment.b);
        if (a && b) lines.push(...world([a.x, a.y]), ...world([b.x, b.y]));
      }
      for (const arc of sketch.arcs ?? []) {
        let samples: SketchUV[];
        try {
          samples = sampleSketchArc(sketch, arc, false, 0.1);
        } catch {
          continue;
        }
        const end = sketch.points.find((p) => p.id === arc.b);
        if (end) samples.push([end.x, end.y]);
        for (let i = 1; i < samples.length; i++)
          lines.push(...world(samples[i - 1]), ...world(samples[i]));
      }
      this.addSketchLines(this.sketchGeometry, lines, "#eeeeee");
      const constrained = new Set<string>();
      for (const c of sketch.constraints) {
        if ("point" in c) constrained.add(c.point);
        if ("a" in c) {
          constrained.add(c.a);
          constrained.add(c.b);
        }
        const ids =
          "segment" in c
            ? [c.segment]
            : "first" in c
              ? [c.first, c.second]
              : "arc" in c
                ? [c.arc]
                : [];
        for (const id of ids) {
          const primitive =
            sketch.segments.find((s) => s.id === id) ??
            sketch.arcs?.find((s) => s.id === id);
          if (primitive) {
            constrained.add(primitive.a);
            constrained.add(primitive.b);
          }
        }
      }
      // Shared endpoints join primitives even without a separate coincidence relation.
      for (const p of sketch.points)
        if (
          sketch.segments.filter((s) => s.a === p.id || s.b === p.id).length > 1
        )
          constrained.add(p.id);
      for (const [hasConstraint, color] of editor.showControlPoints === false
        ? []
        : ([
            [false, "#ee933d"],
            [true, "#398ce5"],
          ] as const)) {
        const positions = sketch.points
          .filter((p) => constrained.has(p.id) === hasConstraint)
          .flatMap((p) => world([p.x, p.y]));
        if (positions.length) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(positions, 3),
          );
          const points = new THREE.Points(
            geometry,
            new THREE.PointsMaterial({
              color,
              size: 8,
              sizeAttenuation: false,
              depthTest: false,
            }),
          );
          points.renderOrder = 11;
          this.sketchGeometry.add(points);
        }
      }
    }
    this.invalidate();
  }
  viewSketchNormal(): void {
    if (!this.sketchEditor) return;
    const frame =
      this.sketchEditor.sketch.frame ?? coordinateSketchFrame("OXY", 0);
    const bounds = new THREE.Box3().setFromObject(this.sketchGeometry);
    if (this.sketchEditor.sketch.reference && this.section.visible)
      bounds.union(new THREE.Box3().setFromObject(this.section));
    const center = bounds.isEmpty()
      ? new THREE.Vector3(...frame.origin)
      : bounds.getCenter(new THREE.Vector3());
    const size = bounds.isEmpty()
      ? 40
      : Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius * 2, 10);
    const distance = frameCamera(this.camera, size / 2);
    this.camera.up.set(...frame.v);
    this.controls.target.copy(center);
    this.camera.position
      .copy(center)
      .addScaledVector(new THREE.Vector3(...frame.normal), distance);
    this.camera.lookAt(center);
    updateCameraClipping(this.camera, bounds);
    this.controls.update();
    this.invalidate();
  }
  private addSketchLines(
    group: THREE.Group,
    positions: number[],
    color: string,
  ): void {
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color, depthTest: false }),
    );
    lines.renderOrder = 10;
    group.add(lines);
  }
  private sketchPlanePoint(x: number, y: number): SketchUV | null {
    if (!this.sketchEditor) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const frame =
      this.sketchEditor.sketch.frame ?? coordinateSketchFrame("OXY", 0);
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((x - rect.left) / rect.width) * 2 - 1,
        1 - ((y - rect.top) / rect.height) * 2,
      ),
      this.camera,
    );
    const normal = new THREE.Vector3(...frame.normal);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      new THREE.Vector3(...frame.origin),
    );
    const hit = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (
      !hit ||
      hit.toArray().some((n) => !Number.isFinite(n) || Math.abs(n) > 1e9)
    )
      return null;
    hit.sub(new THREE.Vector3(...frame.origin));
    return [
      hit.dot(new THREE.Vector3(...frame.u)),
      hit.dot(new THREE.Vector3(...frame.v)),
    ];
  }
  private beginSketchDrag(event: PointerEvent): boolean {
    const editor = this.sketchEditor;
    if (
      !editor ||
      editor.tool === "navigate" ||
      event.button !== 0 ||
      !event.isPrimary ||
      event.ctrlKey ||
      event.shiftKey
    )
      return false;
    const start = this.sketchPlanePoint(event.clientX, event.clientY);
    if (!start) return false;
    const adjacent = this.sketchPlanePoint(event.clientX + 8, event.clientY);
    const tolerance = adjacent
      ? Math.hypot(adjacent[0] - start[0], adjacent[1] - start[1])
      : 0;
    let pointId: string | undefined;
    if (editor.tool === "move") {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const frame = editor.sketch.frame ?? coordinateSketchFrame("OXY", 0);
      let nearest = 10;
      for (const p of editor.sketch.points) {
        const screen = new THREE.Vector3(
          ...sketchWorldPoint(frame, [p.x, p.y]),
        ).project(this.camera);
        const distance = Math.hypot(
          rect.left + ((screen.x + 1) * rect.width) / 2 - event.clientX,
          rect.top + ((1 - screen.y) * rect.height) / 2 - event.clientY,
        );
        if (distance < nearest && screen.z >= -1 && screen.z <= 1) {
          nearest = distance;
          pointId = p.id;
        }
      }
      if (!pointId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      }
    }
    this.sketchDrag = {
      id: event.pointerId,
      start,
      end: start,
      pointId,
      tolerance,
    };
    this.pointer = null;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }
  private renderSketchDrag(): void {
    this.clearGroup(this.sketchPreview);
    if (
      this.sketchEditor &&
      ["circle", "circle3", "arc3"].includes(this.sketchEditor.tool)
    ) {
      const drag = this.sketchDrag;
      const picked =
        this.sketchEditor.tool === "circle"
          ? drag
            ? [drag.start, drag.end]
            : []
          : [
              ...this.sketchCurvePoints,
              ...(drag
                ? [drag.end]
                : this.sketchCurveHover
                  ? [this.sketchCurveHover]
                  : []),
            ];
      const frame =
        this.sketchEditor.sketch.frame ?? coordinateSketchFrame("OXY", 0);
      try {
        const points = previewSketchCurve(this.sketchEditor.tool, picked);
        const positions: number[] = [];
        for (let i = 1; i < points.length; i++)
          positions.push(
            ...sketchWorldPoint(frame, points[i - 1]),
            ...sketchWorldPoint(frame, points[i]),
          );
        this.addSketchLines(this.sketchPreview, positions, "#ee933d");
        if (this.sketchCurvePoints.length) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(
              this.sketchCurvePoints.flatMap((p) => sketchWorldPoint(frame, p)),
              3,
            ),
          );
          const markers = new THREE.Points(
            geometry,
            new THREE.PointsMaterial({
              color: "#ee933d",
              size: 8,
              sizeAttenuation: false,
              depthTest: false,
            }),
          );
          markers.renderOrder = 11;
          this.sketchPreview.add(markers);
        }
      } catch {
        /* Invalid transient geometry is rejected on acceptance. */
      }
      this.invalidate();
      return;
    }
    if (this.sketchDrag && this.sketchEditor) {
      const frame =
        this.sketchEditor.sketch.frame ?? coordinateSketchFrame("OXY", 0);
      const drag = this.sketchDrag;
      const start = drag.pointId
        ? this.sketchEditor.sketch.points.find((p) => p.id === drag.pointId)
        : null;
      this.addSketchLines(
        this.sketchPreview,
        [
          ...sketchWorldPoint(frame, start ? [start.x, start.y] : drag.start),
          ...sketchWorldPoint(frame, drag.end),
        ],
        "#ee933d",
      );
    }
    this.invalidate();
  }
  private cancelSketchDrag(resetCurvePoints = true): void {
    if (
      this.sketchDrag &&
      this.renderer.domElement.hasPointerCapture(this.sketchDrag.id)
    )
      this.renderer.domElement.releasePointerCapture(this.sketchDrag.id);
    this.sketchDrag = undefined;
    if (resetCurvePoints) this.sketchCurvePoints = [];
    this.sketchCurveHover = undefined;
    this.clearGroup(this.sketchPreview);
    this.invalidate();
  }
  private sketchKeyDown(event: KeyboardEvent): void {
    if (
      event.key === "Escape" &&
      (this.sketchDrag || this.sketchCurvePoints.length)
    ) {
      this.cancelSketchDrag();
      event.preventDefault();
    }
  }
  private screenPoint(x: number, y: number): [number, number] {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return [x - rect.left, y - rect.top];
  }
  private drawPaintStroke(event: PointerEvent): void {
    const [x, y] = this.screenPoint(event.clientX, event.clientY);
    this.paintOverlay.style.display = "block";
    this.paintCursor.setAttribute("cx", String(x));
    this.paintCursor.setAttribute("cy", String(y));
    this.paintCursor.setAttribute("r", String(this.brushPixels));
    this.paintTrail.setAttribute("stroke-width", String(this.brushPixels * 2));
    this.paintTrail.setAttribute(
      "d",
      this.brushPath.length
        ? this.brushPath
            .map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`)
            .join(" ") + ` L${x},${y} Z`
        : "",
    );
  }
  private paintScreen(event: PointerEvent, commit = false): void {
    const endpoint = this.screenPoint(event.clientX, event.clientY);
    this.brushPath.push(endpoint);
    this.drawPaintStroke(event);
    if (commit)
      this.applyScreenRegion(event, {
        kind: "lasso",
        points: this.brushPath.slice(),
        radius: this.brushPixels,
      });
  }
  private doubleClick = (event: MouseEvent): void => {
    if (this.brushing || this.sketchEditor || this.pickTargetId) return;
    const id = this.pickAt(event as PointerEvent);
    if (id) this.onEditScan?.(id);
  };
  private applyScreenRegion(event: PointerEvent, region: ScreenRegion): void {
    const id = this.selectedId,
      item = id ? this.objects.get(id) : undefined;
    if (!id || !item?.mesh.visible || !this.onSelection) return;
    try {
      item.selectionIndex ??= new AsyncScreenSelectionIndex(
        item.positions,
        item.hidden,
      );
      const rect = this.renderer.domElement.getBoundingClientRect();
      const index = item.selectionIndex;
      const generation = this.selectionGeneration;
      const remove = subtractSelection(this.subtract, event.altKey);
      this.onSelectionStatus?.("pending");
      void index
        .select(this.camera, region, {
          width: rect.width,
          height: rect.height,
          through: this.selectThrough,
        })
        .then((mask) => {
          if (
            !this.disposed &&
            this.selectionGeneration === generation &&
            this.objects.get(id) === item &&
            item.selectionIndex === index &&
            this.selectedId === id
          )
            this.onSelection?.(id, mask, remove);
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") return;
          this.onSelectionError?.(
            error instanceof Error ? error.message : String(error),
          );
        })
        .finally(() => {
          if (this.selectionGeneration === generation)
            this.onSelectionStatus?.("complete");
        });
    } catch (error) {
      this.onSelectionError?.(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  private drawSelectionRegion(event: PointerEvent): void {
    if (!this.pointer) return;
    const a = this.screenPoint(this.pointer.x, this.pointer.y),
      b = this.screenPoint(event.clientX, event.clientY);
    Object.assign(this.selectionOverlay.style, {
      left: Math.min(a[0], b[0]) + "px",
      top: Math.min(a[1], b[1]) + "px",
      width: Math.abs(a[0] - b[0]) + "px",
      height: Math.abs(a[1] - b[1]) + "px",
      borderRadius: this.selectionTool === "circle" ? "50%" : "0",
    });
    this.selectionOverlay.hidden = false;
  }
  private selectionWheel = (event: WheelEvent): void => {
    if (!this.brushing || !event.ctrlKey || !this.onBrushScale) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.onBrushScale(
      Math.exp(
        -Math.max(
          -100,
          Math.min(
            100,
            event.deltaY *
              (event.deltaMode === 1
                ? 16
                : event.deltaMode === 2
                  ? this.container.clientHeight
                  : 1),
          ),
        ) * 0.0005,
      ),
    );
  };
  private pickAt = (event: PointerEvent): string | undefined => {
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
      .filter(
        (item) =>
          item.mesh.visible &&
          (!this.pickTargetId ||
            item.mesh.userData.entityId === this.pickTargetId),
      )
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
    if (
      this.brushing &&
      this.selectionTool === "wand" &&
      hit.faceIndex != null
    ) {
      const item = this.objects.get(id)!;
      const mask = new Uint8Array(item.positions.length / 9);
      mask[item.triangleSlots?.[hit.faceIndex] ?? hit.faceIndex] = 1;
      this.onSelection?.(
        id,
        mask,
        subtractSelection(this.subtract, event.altKey),
      );
    } else this.onPick([hit.point.x, hit.point.y, hit.point.z], id);
    return id;
  };

  setPickTarget(entityId: string | null): void {
    this.pickTargetId = entityId;
  }

  setEntities(entities: Entity[], selectedId: string | null): void {
    if (selectedId !== this.selectedId) this.clearDeviations();
    this.selectedId = selectedId;
    const ids = new Set(entities.map((entity) => entity.id));
    for (const [id, item] of this.objects) {
      if (!ids.has(id)) {
        this.scene.remove(item.mesh);
        item.selectionIndex?.dispose();
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
      if (
        item.positions !== entity.positions ||
        item.hidden !== entity.meshSelection?.hidden
      ) {
        item.selectionIndex?.dispose();
        item.mesh.geometry.dispose();
        item.selectionIndex = undefined;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          entity.positions instanceof Float32Array
            ? new THREE.BufferAttribute(entity.positions, 3)
            : new THREE.Float32BufferAttribute(entity.positions, 3),
        );
        item.triangleSlots = undefined;
        if (entity.meshSelection?.hidden.length) {
          const hidden = new Set(entity.meshSelection.hidden);
          const slots: number[] = [],
            indices = new Uint32Array(
              (entity.positions.length / 9 - hidden.size) * 3,
            );
          let offset = 0;
          for (let i = 0; i < entity.positions.length / 9; i++)
            if (!hidden.has(i)) {
              slots.push(i);
              indices[offset++] = i * 3;
              indices[offset++] = i * 3 + 1;
              indices[offset++] = i * 3 + 2;
            }
          geometry.setIndex(new THREE.BufferAttribute(indices, 1));
          item.triangleSlots = slots;
        }
        item.hidden = entity.meshSelection?.hidden;
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

  fitView(entityId?: string): void {
    const item = entityId ? this.objects.get(entityId) : undefined;
    if (entityId && !item) return;
    const bounds = item
      ? new THREE.Box3().setFromObject(item.mesh)
      : this.bounds;
    const extent = bounds.isEmpty()
      ? this.extent
      : Math.max(...bounds.getSize(new THREE.Vector3()).toArray(), 0.00001);
    const center = bounds.isEmpty()
      ? new THREE.Vector3()
      : bounds.getCenter(new THREE.Vector3());
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    if (direction.lengthSq() === 0) direction.set(1, -1, 0.8).normalize();
    const radius = bounds.isEmpty()
      ? extent / 2
      : Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius, 0.00001);
    const distance = frameCamera(this.camera, radius);
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.lookAt(center);
    updateCameraClipping(this.camera, bounds);
    this.controls.minDistance = extent * 0.0001;
    this.controls.maxDistance = distance * 20;
    this.controls.update();
    this.invalidate();
  }

  getProjection(): Projection {
    return this.camera instanceof THREE.OrthographicCamera
      ? "orthographic"
      : "perspective";
  }
  setProjection(projection: Projection): void {
    if (projection === this.getProjection()) return;
    this.camera = convertProjection(
      this.camera,
      this.controls.target,
      projection,
    );
    this.controls.object = this.camera;
    this.controls.update();
    this.invalidate();
  }

  rotateView(
    direction: "left" | "right" | "up" | "down",
    degrees: number,
  ): void {
    if (!Number.isFinite(degrees)) return;
    const pixels = THREE.MathUtils.degToRad(degrees) / 0.008;
    rotateCamera(
      this.camera,
      this.controls.target,
      direction === "left" ? pixels : direction === "right" ? -pixels : 0,
      direction === "up" ? pixels : direction === "down" ? -pixels : 0,
    );
    this.controls.update();
    this.invalidate();
  }

  setView(
    view: "iso" | "top" | "bottom" | "front" | "back" | "left" | "right",
  ): void {
    this.camera.up.set(0, 0, 1);
    const direction =
      view === "top"
        ? new THREE.Vector3(0, -0.00001, 1)
        : view === "bottom"
          ? new THREE.Vector3(0, -0.00001, -1)
          : view === "left"
            ? new THREE.Vector3(-1, 0, 0)
            : view === "back"
              ? new THREE.Vector3(0, 1, 0)
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
  setBrush(enabled: boolean): void {
    if (!enabled) this.paintOverlay.style.display = "none";
    this.brushing = enabled;
    if (enabled) {
      const item = this.selectedId
        ? this.objects.get(this.selectedId)
        : undefined;
      if (item?.mesh.visible) {
        item.selectionIndex ??= new AsyncScreenSelectionIndex(
          item.positions,
          item.hidden,
        );
        item.selectionIndex.prepare();
      }
    }
    Object.assign(
      this.controls.mouseButtons,
      cameraMouseButtons(enabled, { ctrlKey: false, shiftKey: false }),
    );
  }
  setSelectionOptions(
    tool: "brush" | "rectangle" | "circle" | "wand",
    radiusPixels: number,
    through: boolean,
    subtract: boolean,
  ): void {
    this.selectionTool = tool;
    this.brushPixels = radiusPixels;
    this.paintCursor.setAttribute("r", String(radiusPixels));
    if (tool !== "brush") this.paintOverlay.style.display = "none";
    this.selectThrough = through;
    this.subtract = subtract;
  }
  setTriangleSelection(positions?: Positions, mask?: Uint8Array): void {
    this.clearGroup(this.triangleSelection);
    // A selection reset can render one effect after the newly selected geometry.
    // Never upload stale triangle slots from the previous object.
    if (positions && mask && mask.length * 9 === positions.length) {
      let count = 0;
      for (const value of mask) count += value;
      if (count) {
        const buffer = new Float32Array(count * 9);
        let next = 0;
        for (let i = 0; i < mask.length; i++)
          if (mask[i])
            for (let j = 0; j < 9; j++) buffer[next++] = positions[i * 9 + j];
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(buffer, 3));
        this.triangleSelection.add(
          new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({
              color: "#e44b5b",
              side: THREE.DoubleSide,
              transparent: true,
              opacity: 0.7,
              depthWrite: false,
              polygonOffset: true,
              polygonOffsetFactor: -1,
              polygonOffsetUnits: -1,
            }),
          ),
        );
      }
    }
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

  setSectionLines(
    segments: number[],
    color = "#ed8a30",
    projected?: number[],
    display?: "points" | "lines" | "hidden",
  ): void {
    this.clearGroup(this.section);
    if (display !== undefined) this.section.visible = display !== "hidden";
    if (display === "hidden") {
      this.invalidate();
      return;
    }
    for (const [lines, tint] of [
      [segments, color],
      [projected ?? [], "#888888"],
    ] as const) {
      if (lines.length) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(lines, 3),
        );
        const primitive =
          display === "points"
            ? new THREE.Points(
                geometry,
                new THREE.PointsMaterial({
                  color: tint,
                  size: 3,
                  sizeAttenuation: false,
                  depthTest: false,
                }),
              )
            : new THREE.LineSegments(
                geometry,
                new THREE.LineBasicMaterial({ color: tint, depthTest: false }),
              );
        primitive.renderOrder = 9;
        this.section.add(primitive);
      }
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
  setAlignmentMarkers(markers: { point: Vec3; label: string }[]): void {
    this.landmarkOverlay.replaceChildren();
    this.landmarkLabels = markers.map((marker) => {
      const element = document.createElement("span");
      element.textContent = marker.label;
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", `Alignment landmark ${marker.label}`);
      element.style.cssText = `position:absolute;transform:translate(-50%,-50%);padding:3px 5px;border-radius:3px;color:#111;background:${marker.label.startsWith("M") ? "#9dddac" : "#edc98f"};font-weight:700;font-size:12px`;
      this.landmarkOverlay.appendChild(element);
      return { point: marker.point, element };
    });
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
    values: Positions | null,
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
    this.controls.removeEventListener("start", this.invalidate);
    this.controls.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.pointerDown, true);
    canvas.removeEventListener("wheel", this.selectionWheel, true);
    canvas.removeEventListener("contextmenu", this.contextMenu);
    canvas.removeEventListener("pointermove", this.pointerMove);
    canvas.removeEventListener("pointerleave", this.pointerLeave);
    canvas.removeEventListener("pointerup", this.pointerUp);
    canvas.removeEventListener("pointercancel", this.pointerCancel);
    canvas.removeEventListener("dblclick", this.doubleClick);
    window.removeEventListener("keydown", this.sketchKeyDown);
    for (const item of this.objects.values()) {
      item.selectionIndex?.dispose();
      item.mesh.geometry.dispose();
      item.mesh.material.dispose();
    }
    this.objects.clear();
    this.clearGroup(this.section);
    this.clearGroup(this.measurement);
    this.clearGroup(this.triangleSelection);
    this.clearGroup(this.sketchGeometry);
    this.clearGroup(this.sketchPreview);
    this.grid.geometry.dispose();
    this.gridScene.clear();
    if (Array.isArray(this.grid.material))
      this.grid.material.forEach((material) => material.dispose());
    else this.grid.material.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
    this.gizmo.dispose();
    this.selectionOverlay.remove();
    this.paintOverlay.remove();
    this.landmarkOverlay.remove();
    this.landmarkLabels = [];
  }
}
