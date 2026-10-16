import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";

it("Escape cancels a pending released bridge even without an active pointer drag", () => {
  const view = viewport(),
    onGesture = vi.fn();
  view.setScanBridge({ boundaries: [rim], onGesture });
  view.sketchKeyDown({
    key: "Escape",
    code: "Escape",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
  });
  expect(onGesture).toHaveBeenCalledWith("cancel", expect.any(Object), null);
});

function viewport() {
  const view = Object.create(Viewport.prototype) as any;
  const canvas = {
    style: {},
    dataset: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: () => true,
  };
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  Object.assign(view, {
    scene: new THREE.Scene(),
    renderer: { domElement: canvas },
    camera,
    bridgePreview: new THREE.Group(),
    objects: new Map(),
    controls: { enabled: true },
    raycaster: new THREE.Raycaster(),
    invalidate: vi.fn(),
    cancelViewTransition: vi.fn(),
  });
  return view;
}
const rim = { closed: true, points: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0] };
const event = (x: number, y: number, pointerId = 1) => ({
  clientX: x,
  clientY: y,
  pointerId,
  button: 0,
  buttons: 1,
  isPrimary: true,
  preventDefault: vi.fn(),
  stopImmediatePropagation: vi.fn(),
});

it("rejects clipped-away attachment edges and clips the facet preview like its source", () => {
  const view = viewport(),
    onGesture = vi.fn();
  const material = new THREE.MeshStandardMaterial({
    clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)],
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  view.selectedId = "source";
  view.objects.set("source", { mesh });
  view.setScanBridge({ boundaries: [rim], onGesture });
  expect(view.beginBridgeDrag(event(100, 150))).toBe(false);
  view.setBridgePreview(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0]));
  expect(view.bridgePreview.children[0].material.clippingPlanes).toEqual(
    material.clippingPlanes,
  );
  view.setBridgePreview();
  mesh.geometry.dispose();
  material.dispose();
});
it("captures an edge drag, previews the snapped opposite edge, and commits once on release", () => {
  const view = viewport(),
    onGesture = vi.fn();
  expect(typeof view.setScanBridge).toBe("function");
  view.setScanBridge({ boundaries: [rim], onGesture });
  view.pointerDown(event(100, 150));
  view.pointerMove(event(100, 50));
  expect(onGesture).toHaveBeenLastCalledWith(
    "preview",
    { boundary: 0, edge: 0 },
    { boundary: 0, edge: 2 },
  );
  view.pointerUp(event(100, 50));
  expect(onGesture).toHaveBeenLastCalledWith(
    "commit",
    { boundary: 0, edge: 0 },
    { boundary: 0, edge: 2 },
  );
  expect(view.controls.enabled).toBe(true);
  expect(view.renderer.domElement.releasePointerCapture).toHaveBeenCalledWith(
    1,
  );
});
it("cancels without commit when released off the rim or the tool closes", () => {
  const view = viewport(),
    onGesture = vi.fn();
  expect(typeof view.setScanBridge).toBe("function");
  view.setScanBridge({ boundaries: [rim], onGesture });
  view.pointerDown(event(100, 150));
  view.pointerUp(event(100, 100));
  expect(onGesture).toHaveBeenLastCalledWith(
    "cancel",
    { boundary: 0, edge: 0 },
    null,
  );
  view.pointerDown(event(100, 150));
  view.setScanBridge(null);
  expect(onGesture.mock.calls.some(([phase]) => phase === "commit")).toBe(
    false,
  );
  expect(view.controls.enabled).toBe(true);
});
it("does not attach a bridge to a boundary hidden behind another surface", () => {
  const view = viewport(),
    onGesture = vi.fn();
  expect(typeof view.setScanBridge).toBe("function");
  const blocker = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4),
    new THREE.MeshBasicMaterial(),
  );
  blocker.position.z = 1;
  blocker.updateMatrixWorld();
  view.objects.set("blocker", { mesh: blocker });
  view.setScanBridge({ boundaries: [rim], onGesture });
  expect(view.beginBridgeDrag(event(100, 150))).toBe(false);
  expect(onGesture).not.toHaveBeenCalled();
  blocker.geometry.dispose();
  blocker.material.dispose();
});

it("picks and bridges separate open boundaries without inventing a closing edge", () => {
  const view = viewport(),
    onGesture = vi.fn();
  view.setScanBridge({
    boundaries: [
      { closed: false, points: [-1, -1, 0, 1, -1, 0] },
      { closed: false, points: [-1, 1, 0, 1, 1, 0] },
    ],
    onGesture,
  });
  view.pointerDown(event(100, 150));
  view.pointerMove(event(100, 50));
  expect(onGesture).toHaveBeenLastCalledWith(
    "preview",
    { boundary: 0, edge: 0 },
    { boundary: 1, edge: 0 },
  );
  view.pointerUp(event(100, 50));
  expect(onGesture).toHaveBeenLastCalledWith(
    "commit",
    { boundary: 0, edge: 0 },
    { boundary: 1, edge: 0 },
  );
  expect(view.bridgeEdgeAt(event(50, 100))).toBeNull();
});
it("highlights the hovered edge with a crosshair and clears the cue on tool exit", () => {
  const view = viewport();
  view.setScanBridge({ boundaries: [rim], onGesture: vi.fn() });
  view.pointerMove({ ...event(100, 150), buttons: 0 });
  expect(view.renderer.domElement.style.cursor).toBe("crosshair");
  expect(view.bridgeHover.children.length).toBeGreaterThan(0);
  view.setScanBridge(null);
  expect(view.bridgeHover.children).toHaveLength(0);
  expect(view.renderer.domElement.style.cursor).toBe("");
});
it("does not raycast the scene once for every nearby boundary segment", () => {
  const view = viewport();
  const rimCopies = Array.from({ length: 100 }, () => rim);
  view.setScanBridge({ boundaries: rimCopies, onGesture: vi.fn() });
  const intersect = vi.spyOn(view.raycaster, "intersectObjects");
  expect(view.bridgeEdgeAt(event(100, 150))).toEqual({ boundary: 0, edge: 0 });
  expect(intersect.mock.calls.length).toBeLessThanOrEqual(4);
});

it("preserves inventory indices and rejects the artificial closing edge of an open path", () => {
  const view = viewport();
  view.setScanBridge({
    boundaries: [
      { closed: false, points: [] },
      { closed: false, points: [-1, -1, 0, 1, -1, 0, 1, 1, 0] },
    ],
    onGesture: vi.fn(),
  });
  expect(view.bridgeEdgeAt(event(100, 150))).toEqual({ boundary: 1, edge: 0 });
  expect(view.bridgeEdgeAt(event(100, 100))).toBeNull();
});
it("rejects boundary edges behind a perspective camera", () => {
  const view = viewport();
  view.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  view.camera.updateMatrixWorld();
  view.setScanBridge({
    boundaries: [{ closed: false, points: [-0.5, 0, 1, 0.5, 0, 1] }],
    onGesture: vi.fn(),
  });
  expect(view.bridgeEdgeAt(event(100, 100))).toBeNull();
});
it("avoids unindexed large-mesh hover raycasts and exposes a preparation hint", () => {
  const view = viewport();
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  mesh.geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(30000 * 3), 3),
  );
  view.objects.set("large", { mesh });
  view.setScanBridge({ boundaries: [rim], onGesture: vi.fn() });
  const raycast = vi.spyOn(view.raycaster, "intersectObjects");
  expect(view.bridgeEdgeAt(event(100, 150))).toBeNull();
  expect(raycast).not.toHaveBeenCalled();
  expect(view.renderer.domElement.dataset.bridgePicking).toBe("preparing");
  expect(view.renderer.domElement.title).toContain(
    "Preparing boundary picking",
  );
  mesh.geometry.dispose();
  mesh.material.dispose();
});

it("does not touch bridge pointer presentation when disposing an inactive tool", () => {
  const view = Object.create(Viewport.prototype) as any;
  view.renderer = { domElement: {} };
  expect(() => view.cancelBridgeDrag()).not.toThrow();
});

it("exposes hovered edge, active drag, and preview state through the agent viewport", () => {
  const view = viewport();
  Object.assign(view, {
    container: { clientWidth: 200, clientHeight: 200 },
    bounds: new THREE.Box3(),
    advanceViewTransition: vi.fn(),
    updateInteractiveMirror: vi.fn(),
  });
  view.controls.target = new THREE.Vector3();
  view.setScanBridge({ boundaries: [rim], onGesture: vi.fn() });
  view.pointerMove({ ...event(100, 150), buttons: 0 });
  expect(view.inspectAgentView().bridge).toEqual({
    mode: "bridge",
    hovered: { boundary: 0, edge: 0 },
    dragStart: null,
    picking: "ready",
    previewTriangles: 0,
  });
  view.pointerDown(event(100, 150));
  expect(view.inspectAgentView().bridge.dragStart).toEqual({
    boundary: 0,
    edge: 0,
  });
  view.setScanBridge(null);
  expect(view.inspectAgentView().bridge).toBeUndefined();
});

it("does not let four hidden layers starve a visible fifth boundary at the same screen position", () => {
  const view = viewport();
  const paths = [0, 0, 0, 0, 1].map((z) => ({
    closed: false,
    points: [-1, -1, z, 1, -1, z],
  }));
  const blocker = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4),
    new THREE.MeshStandardMaterial(),
  );
  blocker.position.z = 1;
  blocker.updateMatrixWorld();
  view.objects.set("source", { mesh: blocker });
  view.selectedId = "source";
  view.setScanBridge({ boundaries: paths, onGesture: vi.fn() });
  const rays = vi.spyOn(view.raycaster, "intersectObjects");
  expect(view.bridgeEdgeAt(event(100, 150))).toEqual({ boundary: 4, edge: 0 });
  expect(rays).toHaveBeenCalledTimes(1);
  blocker.geometry.dispose();
  blocker.material.dispose();
});
it("filters clipped candidates before choosing the visible attachment", () => {
  const view = viewport();
  const paths = [-1, -1, -1, -1, 1].map((z) => ({
    closed: false,
    points: [-1, -1, z, 1, -1, z],
  }));
  const source = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({
      clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)],
    }),
  );
  view.objects.set("source", { mesh: source });
  view.selectedId = "source";
  view.setScanBridge({ boundaries: paths, onGesture: vi.fn() });
  expect(view.bridgeEdgeAt(event(100, 150))).toEqual({ boundary: 4, edge: 0 });
  source.geometry.dispose();
  source.material.dispose();
});
it("reuses an occlusion ray for duplicated hidden layers while searching another visible edge", () => {
  const view = viewport();
  const paths = [0, 0, 0, 0, 0, 0].map((z) => ({
    closed: false,
    points: [-1, -1, z, 1, -1, z],
  }));
  paths.push({ closed: false, points: [-1, -0.8, 0, 1, -0.8, 0] });
  const blocker = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 0.1),
    new THREE.MeshStandardMaterial(),
  );
  blocker.position.set(0, -1, 1);
  blocker.updateMatrixWorld();
  view.objects.set("blocker", { mesh: blocker });
  view.setScanBridge({ boundaries: paths, onGesture: vi.fn() });
  const rays = vi.spyOn(view.raycaster, "intersectObjects");
  expect(view.bridgeEdgeAt(event(100, 150))).toEqual({ boundary: 6, edge: 0 });
  expect(rays).toHaveBeenCalledTimes(2);
  blocker.geometry.dispose();
  blocker.material.dispose();
});

it("draws a bridge immediately while dragging through empty space, without a worker result", () => {
  const view = viewport(),
    onGesture = vi.fn();
  view.setScanBridge({ boundaries: [rim], onGesture });
  view.pointerDown(event(100, 150));
  view.pointerMove(event(100, 100));
  expect(
    Number(view.renderer.domElement.dataset.bridgePreview),
  ).toBeGreaterThan(0);
  view.pointerMove(event(100, 50));
  expect(
    Number(view.renderer.domElement.dataset.bridgePreview),
  ).toBeGreaterThan(0);
  view.pointerUp(event(100, 50));
  expect(Number(view.renderer.domElement.dataset.bridgePreview)).toBe(0);
});
it("highlights an entire hole under the pointer and selects it directly", () => {
  const view = viewport(),
    onSelectBoundary = vi.fn();
  view.setScanBridge({
    mode: "holes",
    boundaries: [rim],
    onGesture: vi.fn(),
    onSelectBoundary,
  });
  view.pointerMove({ ...event(100, 100), buttons: 0 });
  expect(view.bridgeHover.children.length).toBeGreaterThan(0);
  view.pointerDown(event(100, 100));
  expect(onSelectBoundary).toHaveBeenCalledExactlyOnceWith(0);
  expect(view.controls.enabled).toBe(true);
});

it("double-clicks the visible hole once without reopening the scan editor", () => {
  const view = viewport(),
    onFillBoundary = vi.fn();
  view.onEditScan = vi.fn();
  view.pickAt = vi.fn(() => "source");
  view.setScanBridge({
    mode: "holes",
    boundaries: [rim],
    onGesture: vi.fn(),
    onFillBoundary,
  });
  view.doubleClick(event(100, 100));
  expect(onFillBoundary).toHaveBeenCalledExactlyOnceWith(0);
  expect(view.onEditScan).not.toHaveBeenCalled();
  expect(view.pickAt).not.toHaveBeenCalled();
});

it.each([
  { clientX: 190 },
  { ctrlKey: true },
  { shiftKey: true },
  { altKey: true },
  { metaKey: true },
  { button: 2 },
])(
  "does not fill a hole for an outside or modified double-click: %j",
  (override) => {
    const view = viewport(),
      onFillBoundary = vi.fn();
    view.setScanBridge({
      mode: "holes",
      boundaries: [rim],
      onGesture: vi.fn(),
      onFillBoundary,
    });
    view.doubleClick({ ...event(100, 100), ...override });
    expect(onFillBoundary).not.toHaveBeenCalled();
  },
);

it("does not fill clipped, occluded or open boundaries on double-click", () => {
  for (const kind of ["clipped", "occluded", "open"]) {
    const view = viewport(),
      onFillBoundary = vi.fn();
    const material = new THREE.MeshBasicMaterial({
      clippingPlanes:
        kind === "clipped"
          ? [new THREE.Plane(new THREE.Vector3(0, 0, 1), -1)]
          : [],
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), material);
    mesh.position.z = kind === "occluded" ? 1 : -1;
    mesh.updateMatrixWorld();
    view.selectedId = "source";
    view.objects.set("source", { mesh });
    view.setScanBridge({
      mode: "holes",
      boundaries: [{ ...rim, closed: kind !== "open" }],
      onGesture: vi.fn(),
      onFillBoundary,
    });
    view.doubleClick(event(100, 100));
    expect(onFillBoundary).not.toHaveBeenCalled();
    mesh.geometry.dispose();
    material.dispose();
  }
});

it("preserves ordinary scan-editor double-click outside the hole picker", () => {
  const view = viewport();
  view.pickAt = vi.fn(() => "source");
  view.onEditScan = vi.fn();
  view.doubleClick(event(100, 100));
  expect(view.onEditScan).toHaveBeenCalledExactlyOnceWith("source");
});

it.each([0, 1])(
  "does not pick a hole through a retained surface at z=%s",
  (z) => {
    const view = viewport(),
      onSelectBoundary = vi.fn();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshBasicMaterial(),
    );
    mesh.position.z = z;
    mesh.updateMatrixWorld();
    view.objects.set("blocker", { mesh });
    view.setScanBridge({
      mode: "holes",
      boundaries: [rim],
      onGesture: vi.fn(),
      onSelectBoundary,
    });
    expect(view.holeBoundaryAt(event(100, 100))).toBeNull();
    mesh.geometry.dispose();
    mesh.material.dispose();
  },
);

it("picks the innermost visible rim on a curved surface instead of its enclosing outer boundary", () => {
  const view = viewport();
  const outer = {
    closed: true,
    points: rim.points.map((v, i) => (i % 3 === 2 ? 1 : v * 1.5)),
  };
  view.setScanBridge({
    mode: "holes",
    boundaries: [outer, rim],
    onGesture: vi.fn(),
  });
  expect(view.holeBoundaryAt(event(100, 100))).toBe(1);
});
