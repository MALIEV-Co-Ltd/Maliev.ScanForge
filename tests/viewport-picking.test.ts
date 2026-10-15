import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { prepareViewportPicking } from "../src/viewport-picking";

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn();
  payload: any;
  constructor() {
    TestWorker.instances.push(this);
  }
  postMessage(payload: any) {
    this.payload = payload;
  }
  finish() {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(this.payload.positions, 3),
    );
    if (this.payload.index)
      g.setIndex(new THREE.BufferAttribute(this.payload.index, 1));
    const tree = new MeshBVH(g, { indirect: true });
    this.onmessage?.({ data: { tree: MeshBVH.serialize(tree) } });
  }
}
function mesh() {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(10000 * 9);
  for (let i = 0; i < 10000; i++)
    p.set([i * 2, 0, 0, i * 2 + 1, 0, 0, i * 2, 1, 0], i * 9);
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  return new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
}
describe("background viewport picking", () => {
  it("keeps live buffers attached, preserves facet IDs and accelerates GUI and agent raycasts", async () => {
    vi.stubGlobal("Worker", TestWorker);
    try {
      const m = mesh(),
        original = m.geometry.getAttribute("position").array;
      const ray = new THREE.Raycaster(
        new THREE.Vector3(100.2, 0.2, 1),
        new THREE.Vector3(0, 0, -1),
      );
      const before = ray
        .intersectObject(m)
        .map((h) => ({ face: h.faceIndex, p: h.point.toArray() }));
      const ready = prepareViewportPicking(m);
      const w = TestWorker.instances.at(-1)!;
      expect(w.payload.positions).not.toBe(original);
      expect(original.byteLength).toBe(360000);
      w.finish();
      await ready;
      expect(m.geometry.boundsTree).toBeDefined();
      expect(
        ray
          .intersectObject(m)
          .map((h) => ({ face: h.faceIndex, p: h.point.toArray() })),
      ).toEqual(before);
      expect(before[0].face).toBe(50);
      expect(w.terminate).toHaveBeenCalledOnce();
      m.geometry.dispose();
      expect(m.geometry.boundsTree).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("cancels obsolete builds on geometry disposal without attaching stale results", async () => {
    vi.stubGlobal("Worker", TestWorker);
    try {
      const m = mesh();
      const ready = prepareViewportPicking(m);
      const w = TestWorker.instances.at(-1)!;
      m.geometry.dispose();
      await ready;
      expect(w.terminate).toHaveBeenCalledOnce();
      expect(m.geometry.boundsTree).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

it("preserves clipped, transformed and hidden-facet hits through the shared agent picker", async () => {
  vi.stubGlobal("Worker", TestWorker);
  try {
    const { pickCamera } = await import("../src/viewport-agent");
    const m = mesh();
    m.userData.entityId = "scan";
    m.position.set(-100, 0, 0);
    m.updateMatrixWorld(true);
    // Exclude original facet 49; facet 50 remains rendered slot 49.
    const indices = [];
    for (let i = 0; i < 10000; i++)
      if (i !== 49) indices.push(i * 3, i * 3 + 1, i * 3 + 2);
    m.geometry.setIndex(indices);
    m.material.clippingPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -0.1),
    ];
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0.2, 0.2, 2);
    camera.lookAt(0.2, 0.2, 0);
    camera.updateMatrixWorld();
    const before = pickCamera(camera, [m], 0.5, 0.5, 20);
    const ready = prepareViewportPicking(m);
    TestWorker.instances.at(-1)!.finish();
    await ready;
    expect(pickCamera(camera, [m], 0.5, 0.5, 20)).toEqual(before);
    expect(before.hits[0].triangleIndex).toBe(49);
    m.geometry.dispose();
    m.material.dispose();
  } finally {
    vi.unstubAllGlobals();
  }
});
it("serializes builds, reuses each geometry index and retains ordinary picking on worker failure", async () => {
  vi.stubGlobal("Worker", TestWorker);
  try {
    const a = mesh(),
      b = mesh();
    const ra = prepareViewportPicking(a);
    const worker = TestWorker.instances.at(-1)!;
    expect(prepareViewportPicking(a)).toBe(ra);
    const count = TestWorker.instances.length;
    const rb = prepareViewportPicking(b);
    expect(TestWorker.instances).toHaveLength(count);
    worker.onerror?.();
    await ra;
    expect(a.geometry.boundsTree).toBeUndefined();
    const next = TestWorker.instances.at(-1)!;
    expect(next).not.toBe(worker);
    next.finish();
    await rb;
    expect(b.geometry.boundsTree).toBeDefined();
    a.geometry.dispose();
    b.geometry.dispose();
  } finally {
    vi.unstubAllGlobals();
  }
});
