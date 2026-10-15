import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { InteractiveMirrorDisplay } from "../src/interactive-mirror-display";
import { nativeInteractiveMirrorPoints } from "../src/interactive-mirror-selection";
const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const source = () => ({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, -1, 0, 0, 1]),
  flags: new Uint32Array([2, 0, 2]),
});
it("retains source and GPU attribute identities while publishing new native index lists", () => {
  const data = source(),
    changed = vi.fn();
  const display = new InteractiveMirrorDisplay(
    new Map([["scan", data]]),
    changed,
  );
  const settings = {
    normals: data.normals,
    flags: data.flags,
    direction: [0, 0, 1],
    stride: 0,
    baseColor: [0.8, 0.8, 0],
    selectedColor: [0.3, 0.4, 0.5],
    allowanceMilliseconds: 1000000,
    elapsedMilliseconds: 0,
  };
  try {
    display.show([{ entityId: "scan", matrix: pose }], 1);
    const points = display.group.children[0] as THREE.Points;
    const geometry = points.geometry,
      position = geometry.getAttribute("position") as THREE.BufferAttribute,
      normal = geometry.getAttribute("normal") as THREE.BufferAttribute,
      index = geometry.index!;
    expect(position.array).toBe(data.positions);
    expect(normal.array).toBe(data.normals);
    expect(geometry.drawRange.count).toBe(0);
    expect(points.frustumCulled).toBe(false);
    expect((points.material as THREE.PointsMaterial).size).toBe(2);
    expect((points.material as THREE.PointsMaterial).sizeAttenuation).toBe(
      false,
    );
    const first = nativeInteractiveMirrorPoints(settings, {
      sourceColors: true,
    });
    const materialVersion = (points.material as THREE.PointsMaterial).version;
    display.publish("scan", first);
    expect((points.material as THREE.PointsMaterial).version).toBe(
      materialVersion + 1,
    );
    const color = geometry.getAttribute("color") as THREE.BufferAttribute;
    expect(color.array).toBe(first.colors);
    expect(Array.from(index.array.slice(0, geometry.drawRange.count))).toEqual([
      0, 2,
    ]);
    const colorVersion = color.version;
    display.publish("scan", {
      indices: nativeInteractiveMirrorPoints(
        { ...settings, direction: [0, 0, -1] },
        { indicesOnly: true },
      ).indices,
    });
    expect(geometry.index).toBe(index);
    expect(geometry.getAttribute("color")).toBe(color);
    expect(color.version).toBe(colorVersion);
    expect(geometry.drawRange.count).toBe(1);
    expect(index.array[0]).toBe(1);
    for (let i = 0; i < 100; i++)
      display.show(
        [{ entityId: "scan", matrix: pose.map((v, j) => (j === 3 ? i : v)) }],
        2,
      );
    expect(points.geometry).toBe(geometry);
    expect(position.version).toBe(0);
    expect(normal.version).toBe(0);
    expect(points.matrix.elements[12]).toBe(99);
    expect(display.group.matrix.elements[5]).toBe(-1);
    const disposed = vi.fn();
    geometry.addEventListener("dispose", disposed);
    display.clear();
    display.clear();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(display.group.children).toHaveLength(0);
    expect(data.positions.byteLength).toBe(36);
  } finally {
    display.dispose();
  }
});
it("validates every target before replacing display poses or allocating a new target", () => {
  const display = new InteractiveMirrorDisplay(
    new Map([["scan", source()]]),
    () => {},
  );
  try {
    display.show([{ entityId: "scan", matrix: pose }], 0);
    const points = display.group.children[0] as THREE.Points;
    expect(() =>
      display.show(
        [
          { entityId: "scan", matrix: pose.map((v, i) => (i === 3 ? 5 : v)) },
          { entityId: "missing", matrix: pose },
        ],
        2,
      ),
    ).toThrow();
    expect(points.matrix.elements[12]).toBe(0);
    expect(display.group.matrix.elements[10]).toBe(-1);
    expect(() =>
      display.publish("scan", { indices: new Uint32Array([0]) }),
    ).toThrow();
    expect(() =>
      display.publish("scan", {
        indices: new Uint32Array([3]),
        colors: new Float32Array(9),
      }),
    ).toThrow();
    expect(points.geometry.drawRange.count).toBe(0);
    display.dispose();
    expect(() =>
      display.show([{ entityId: "scan", matrix: pose }], 0),
    ).toThrow();
  } finally {
    display.dispose();
  }
});

it("waits for asynchronous shader preparation and cannot reveal a cancelled display", async () => {
  const data = source(),
    display = new InteractiveMirrorDisplay(new Map([["scan", data]]), () => {});
  const camera = new THREE.OrthographicCamera();
  const compileAsync = vi.fn(async () => display.group);
  const render = vi.fn(),
    setRenderTarget = vi.fn();
  const renderer = {
    compileAsync,
    render,
    setRenderTarget,
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getViewport: (v: THREE.Vector4) => v.set(0, 0, 920, 720),
    getScissor: (v: THREE.Vector4) => v.set(0, 0, 920, 720),
    getScissorTest: () => false,
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    setScissorTest: vi.fn(),
  } as unknown as THREE.WebGLRenderer;
  try {
    display.show([{ entityId: "scan", matrix: pose }], 1);
    display.publish("scan", {
      indices: new Uint32Array([0]),
      colors: new Float32Array(9),
    });
    expect(display.group.visible).toBe(false);
    expect(await display.prepare(renderer, camera)).toBe(true);
    expect(display.group.visible).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    expect(setRenderTarget).toHaveBeenLastCalledWith(null, 0, 0);
    display.show([{ entityId: "scan", matrix: pose }], 2);
    expect(await display.prepare(renderer, camera)).toBe(true);
    expect(compileAsync).toHaveBeenCalledTimes(1);
    display.clear();
    display.show([{ entityId: "scan", matrix: pose }], 1);
    display.publish("scan", {
      indices: new Uint32Array([0]),
      colors: new Float32Array(9),
    });
    let finish!: (v: THREE.Group) => void;
    compileAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = display.prepare(renderer, camera);
    const retiredMaterial = (display.group.children[0] as THREE.Points)
      .material as THREE.PointsMaterial;
    const released = vi.fn();
    retiredMaterial.addEventListener("dispose", released);
    display.clear();
    expect(released).not.toHaveBeenCalled();
    finish(display.group);
    expect(await pending).toBe(false);
    expect(released).toHaveBeenCalledTimes(1);
    expect(display.group.visible).toBe(false);
  } finally {
    display.dispose();
  }
});
