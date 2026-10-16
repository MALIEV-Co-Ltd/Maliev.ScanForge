import { expect, it } from "vitest";
import {
  globalQueryInputBytes,
  shareGlobalQueryInput,
} from "../src/scan-global-query-storage";
import type { GlobalQueryWorkerInit } from "../src/scan-global-query-worker";

it("preserves overlapping mixed views across scans while copying each backing once", () => {
  const buffer = new ArrayBuffer(128);
  const points = new Float32Array(buffer, 12, 6);
  points.set([1, 2, 3, 4, 5, 6]);
  const normals = new Float32Array(buffer, 24, 6);
  const triangles = new Uint32Array(buffer, 80, 3);
  const flags = new Uint8Array(buffer, 96, 1);
  const geometry = {
    points,
    normals,
    targetMeshes: [{ vertices: points, triangles, flags }],
  };
  const input = {
    scans: [
      { id: "one", geometry },
      { id: "two", geometry: { ...geometry } },
    ],
  };
  const before = new Uint8Array(buffer).slice();
  const packet = shareGlobalQueryInput(input);
  const a = packet.scans[0].geometry,
    b = packet.scans[1].geometry;
  const mesh = a.targetMeshes![0];
  expect(a.points).toBe(mesh.vertices);
  expect(b.points).toBe(a.points);
  for (const value of [a.points, a.normals, mesh.triangles, mesh.flags!])
    expect(value.buffer).toBe(a.points.buffer);
  expect(a.points.buffer).toBeInstanceOf(SharedArrayBuffer);
  expect(a.points.buffer).not.toBe(buffer);
  expect(a.points.byteOffset).toBe(12);
  expect(a.normals.byteOffset).toBe(24);
  expect(mesh.triangles).toBeInstanceOf(Uint32Array);
  expect(mesh.flags).toBeInstanceOf(Uint8Array);
  expect(new Uint8Array(a.points.buffer)).toEqual(before);
  a.points[3] = 17;
  expect(a.normals[0]).toBe(17);
  expect(new Uint8Array(buffer)).toEqual(before);
  expect(globalQueryInputBytes(input, 2, true)).toBe(256);
  expect(globalQueryInputBytes(input, 2, false)).toBe(384);
});

it("counts whole backings and existing shared storage once rather than view lengths", () => {
  const shared = new SharedArrayBuffer(128),
    ordinary = new ArrayBuffer(256);
  const input: GlobalQueryWorkerInit = {
    scans: [
      {
        id: "one",
        geometry: {
          points: new Float32Array(shared, 12, 3),
          normals: new Float32Array(ordinary, 24, 3),
        },
      },
    ],
  };
  expect(globalQueryInputBytes(input, 2, true)).toBe(128 + 512);
  expect(globalQueryInputBytes(input, 2, false)).toBe(128 + 768);
  const packet = shareGlobalQueryInput(input);
  expect(packet.scans[0].geometry.points).toBe(input.scans[0].geometry.points);
  expect(packet.scans[0].geometry.normals.buffer.byteLength).toBe(256);
});

it("keeps packets independent between pool lifetimes and preserves repeated geometry identity", () => {
  const points = Float32Array.of(1, 2, 3);
  const geometry = { points, normals: points };
  const input = {
    scans: [
      { id: "one", geometry },
      { id: "two", geometry },
    ],
  };
  const first = shareGlobalQueryInput(input),
    second = shareGlobalQueryInput(input);
  expect(first.scans[0].geometry).toBe(first.scans[1].geometry);
  expect(second.scans[0].geometry.points.buffer).not.toBe(
    first.scans[0].geometry.points.buffer,
  );
  expect(points).toEqual(Float32Array.of(1, 2, 3));
});
