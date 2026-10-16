import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { smoothDisplayNormals } from "../src/viewport-display";
function baseline(p: ArrayLike<number>) {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(Array.from(p), 3),
  );
  const w = mergeVertices(g, 1e-6);
  w.computeVertexNormals();
  const e = w.toNonIndexed();
  const n = new Float32Array(e.getAttribute("normal").array);
  e.dispose();
  w.dispose();
  g.dispose();
  return n;
}
const bytes = (a: Float32Array) =>
  Buffer.from(a.buffer, a.byteOffset, a.byteLength);
it("does not materialize a whole JavaScript coordinate array for smooth display", () => {
  const p = new Float32Array(36000);
  for (let i = 0; i < p.length; i++) p[i] = (i % 37) / 37;
  const original = Array.from;
  const spy = vi.spyOn(Array, "from").mockImplementation(((
    value: any,
    ...args: any[]
  ) => {
    if (value?.length >= p.length)
      throw Error("Large JavaScript array allocation");
    return (original as any)(value, ...args);
  }) as typeof Array.from);
  try {
    expect(smoothDisplayNormals(p).length).toBe(p.length);
  } finally {
    spy.mockRestore();
  }
});
it.each(Array.from({ length: 100 }, (_, i) => i + 1))(
  "matches previous weld and normal bytes for seeded case %s",
  (seed) => {
    let s = seed;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const n = seed * 3 + 3,
      vertices = Array.from({ length: 30 }, () => [
        rnd() * 20 - 10,
        rnd() * 20 - 10,
        rnd() * 20 - 10,
      ]);
    const p: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = vertices[Math.floor(rnd() * vertices.length)];
      p.push(...v.map((x) => x + (seed % 4 === 0 ? (rnd() - 0.5) * 1e-6 : 0)));
    }
    const before = [...p],
      a = smoothDisplayNormals(p),
      b = baseline(p);
    expect(Buffer.compare(bytes(a), bytes(b))).toBe(0);
    expect(p).toEqual(before);
  },
);
it.each([0, -0, 0.499999e-6, 0.5e-6, -0.5e-6, 2147.483648, -2147.483648, 1e8])(
  "retains rounding, signed-zero and quantization-wrap behavior at %s",
  (x) => {
    const p = [
      x,
      0,
      0,
      x + 1,
      0,
      0,
      x,
      1,
      0,
      x + 1e-7,
      0,
      0,
      x,
      0,
      1,
      x + 1,
      0,
      0,
    ];
    expect(
      Buffer.compare(bytes(smoothDisplayNormals(p)), bytes(baseline(p))),
    ).toBe(0);
  },
);
it("preserves first-vertex and face order across typed hash-table growth", () => {
  const p = new Float32Array(4096 * 9);
  for (let i = 0; i < p.length; i++)
    p[i] = Math.sin(i * 0.12345) * 100 + i / 100000;
  expect(
    Buffer.compare(bytes(smoothDisplayNormals(p)), bytes(baseline(p))),
  ).toBe(0);
});
