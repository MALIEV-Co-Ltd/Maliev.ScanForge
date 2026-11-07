import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { installSelectionBoundaryAttributes } from "../src/selection-boundary-highlight";

it("glows around the selection outline without glowing on the shared diagonal", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0],
      3,
    ),
  );
  const segments = installSelectionBoundaryAttributes(geometry);
  expect(segments).toHaveLength(24);
  expect(Array.from(segments)).toEqual([
    1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0,
  ]);
  const corner = geometry.getAttribute("processingBarycentric");
  expect(corner.itemSize).toBe(1);
  expect(Array.from(corner.array)).toEqual([0, 1, 2, 0, 1, 2]);
  geometry.dispose();
});

it("matches the original quantized edge counts for coincident, nonmanifold, and degenerate faces", () => {
  const values = [
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0,
    0, 1, 2, 0, 0, 2, 0, 0, 3, 0, 0, 0.0000001, 0, 0, 1, 0, 0, 1, 1, 0,
  ];
  for (let y = 0; y < 35; y++)
    for (let x = 0; x < 35; x++)
      values.push(
        x + 10,
        y,
        0,
        x + 11,
        y,
        0,
        x + 10,
        y + 1,
        0,
        x + 11,
        y,
        0,
        x + 11,
        y + 1,
        0,
        x + 10,
        y + 1,
        0,
      );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(values, 3),
  );
  const p = geometry.getAttribute("position");
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  const tolerance = Math.max(size.x, size.y, size.z, 1) * 1e-6;
  const keys = Array.from({ length: p.count }, (_, i) =>
    [p.getX(i), p.getY(i), p.getZ(i)]
      .map((v) => Math.round(v / tolerance))
      .join(","),
  );
  const key = (a: number, b: number) =>
    keys[a] < keys[b] ? `${keys[a]}:${keys[b]}` : `${keys[b]}:${keys[a]}`;
  const counts = new Map<string, number>();
  for (let i = 0; i < p.count; i += 3)
    for (const [a, b] of [
      [i + 1, i + 2],
      [i + 2, i],
      [i, i + 1],
    ])
      counts.set(key(a, b), (counts.get(key(a, b)) ?? 0) + 1);
  const expected: number[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const flags = [
      counts.get(key(i + 1, i + 2)),
      counts.get(key(i + 2, i)),
      counts.get(key(i, i + 1)),
    ].map((n) => (n === 1 ? 1 : 0));
    for (let edge = 0; edge < 3; edge++) {
      if (!flags[edge]) continue;
      for (const vertex of [i + ((edge + 1) % 3), i + ((edge + 2) % 3)])
        expected.push(p.getX(vertex), p.getY(vertex), p.getZ(vertex));
    }
  }
  expect(Array.from(installSelectionBoundaryAttributes(geometry))).toEqual(
    expected,
  );
  geometry.dispose();
});

it("releases retired boundary tables without detaching selection positions", () => {
  const values: number[] = [];
  for (let i = 0; i < 1800; i++) values.push(i, 0, 0, i, 1, 0, i, 0, 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(values, 3),
  );
  const source = geometry.getAttribute("position").array;
  const prototype = ArrayBuffer.prototype as ArrayBuffer & {
    transfer: (size: number) => ArrayBuffer;
  };
  if (typeof prototype.transfer !== "function") return;
  const spy = vi.spyOn(prototype, "transfer");
  try {
    const segments = installSelectionBoundaryAttributes(geometry);
    expect(segments.length).toBe(values.length * 2);
    expect(source.byteLength).toBe(values.length * 4);
    expect(spy.mock.calls.length).toBeGreaterThan(3);
  } finally {
    spy.mockRestore();
    geometry.dispose();
  }
});

it("keeps the outline when buffer transfer is unavailable", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  const transfer = Object.getOwnPropertyDescriptor(
    ArrayBuffer.prototype,
    "transfer",
  );
  try {
    Object.defineProperty(ArrayBuffer.prototype, "transfer", {
      value: undefined,
      configurable: true,
    });
    expect(installSelectionBoundaryAttributes(geometry)).toHaveLength(18);
    expect(geometry.getAttribute("position").array.byteLength).toBe(36);
  } finally {
    if (transfer)
      Object.defineProperty(ArrayBuffer.prototype, "transfer", transfer);
    else delete (ArrayBuffer.prototype as { transfer?: unknown }).transfer;
    geometry.dispose();
  }
});
