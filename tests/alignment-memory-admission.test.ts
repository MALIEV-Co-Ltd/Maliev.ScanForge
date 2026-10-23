import { expect, it, vi } from "vitest";
import { indexedRenderNormals } from "../src/indexed-mesh";
import { prepareNoiseOctree } from "../src/scan-noise-octree";
import { prepareNativeAlignmentTarget } from "../src/scan-native-alignment-target";
import { queryNoiseOctree } from "../src/scan-noise-octree-query";
import { noiseTriangleDistance } from "../src/scan-noise-deviation";
import {
  acceptLandmarkAlignment,
  beginLandmarkAlignment,
} from "../src/landmark-alignment";
import { registerPairedPoints } from "../src/registration";
import type { Entity, IndexedMesh } from "../src/types";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createWorkflowOperations } from "../src/automation/workflow-operations";

const triangle = [
  [0, 0, 0],
  [140, 0, 0],
  [0, 140, 0],
];
const wide = {
  coordinates: new Float32Array(triangle.flat()),
  indices: Uint32Array.from({ length: 75 }, (_, i) => i % 3),
};

it("retains Float32 normal bytes and indexed order through render expansion", () => {
  const normals = new Float32Array([0.1, -0, 2, 3, 4, 5, -6, 7, -8]);
  const mesh: IndexedMesh = {
    vertices: new Float32Array(triangle.flat()),
    triangles: new Uint32Array([2, 0, 1]),
    normals,
  };
  const result = indexedRenderNormals(mesh);
  expect(result).toBeInstanceOf(Float32Array);
  expect(Array.from(result!)).toEqual([-6, 7, -8, normals[0], -0, 2, 3, 4, 5]);
  expect(Object.is(result![4], -0)).toBe(true);
  expect(result).not.toBe(normals);
  expect(normals[0]).toBe(Math.fround(0.1));
  expect(
    indexedRenderNormals({
      ...mesh,
      normals: [0.1, -0, 2, 3, 4, 5, -6, 7, -8],
    }),
  ).toEqual([-6, 7, -8, 0.1, -0, 2, 3, 4, 5]);
});

it("accepts compact normals through the shared GUI and retry-protected agent landmark operation", async () => {
  const source: Entity = {
    id: "source",
    name: "Source",
    kind: "mesh",
    visible: true,
    opacity: 1,
    color: "#aaa",
    positions: new Float32Array(triangle.flat()),
  };
  const fixed = { ...source, id: "fixed" };
  const normals = new Float32Array([0, -0, 2, 0, 0, 2, 0, 0, 2]);
  const preview = {
    kind: "paired" as const,
    registration: registerPairedPoints(
      Array.from(source.positions),
      Array.from(source.positions),
    ),
    positions: new Float32Array(source.positions),
    indexedMesh: {
      vertices: new Float32Array(source.positions),
      triangles: new Uint32Array([0, 1, 2]),
      normals,
    },
    diagnostics: {},
  };
  const accepted = acceptLandmarkAlignment(
    { ...beginLandmarkAlignment(source, fixed), preview },
    [source, fixed],
  );
  expect(accepted[0].normals).toBeInstanceOf(Float32Array);
  expect(accepted[0].indexedMesh?.normals).toBe(normals);
  expect(accepted[1]).toBe(fixed);
  expect(source.normals).toBeUndefined();
  const state: WorkspaceSnapshot = {
    name: "Alignment",
    entities: [source, fixed],
    history: [],
    future: [],
    authoring: {},
    selectedId: source.id,
    selection: null,
    settings: {},
  };
  let applications = 0;
  const session = { ...beginLandmarkAlignment(source, fixed), preview };
  const host = {
    snapshot: () => state,
    busy: () => false,
    activity: () => {},
    acceptLandmarks: () => {
      state.entities = acceptLandmarkAlignment(session, state.entities);
      applications++;
      return { accepted: true };
    },
  } as unknown as WorkspaceHost;
  const api = new ApplicationApi(host, createWorkflowOperations(host));
  try {
    const request = {
      expectedRevision: api.currentRevision(),
      requestId: "compact-normal-accept",
    };
    const result = await api.invoke("landmark_accept", request);
    expect(result).toMatchObject({ ok: true, result: { accepted: true } });
    expect(await api.invoke("landmark_accept", request)).toEqual(result);
    expect(applications).toBe(1);
    expect(state.entities[0].normals).toEqual(accepted[0].normals);
    expect(state.entities[0].normals).toBeInstanceOf(Float32Array);
  } finally {
    api.dispose();
  }
});

it("admits a bounded alignment tree beyond the legacy node count without changing its winner", () => {
  const prepared = prepareNativeAlignmentTarget(wide)!;
  let nodes = 0;
  const pending = [prepared.root];
  while (pending.length) {
    const node = pending.pop()!;
    nodes++;
    for (const child of Object.values(node.children))
      if (child) pending.push(child);
  }
  expect(nodes).toBeGreaterThan(100000);
  const point = [20, 20, 0.1];
  expect(
    queryNoiseOctree(
      prepared.root,
      point,
      0.5,
      prepared.triangleBounds,
      (_id, radius) =>
        noiseTriangleDistance(
          point,
          triangle[0],
          triangle[1],
          triangle[2],
          radius,
        ),
    ),
  ).toEqual({ triangle: 0, distance: 0.1 });
  // Other noise consumers keep their existing count guard.
  expect(() => prepareNoiseOctree(wide)).toThrow("node budget");
}, 20000);

it("rejects insufficient tree memory and preserves the exact tree when admitted", () => {
  const input = Array.from({ length: 25 }, () => [
    [0, 0, 0],
    [2, 0, 0],
    [0, 2, 0],
  ]);
  expect(() => prepareNoiseOctree(input, 0.5, 10, {}, undefined, 1024)).toThrow(
    "memory budget",
  );
  expect(
    prepareNoiseOctree(input, 0.5, 10, {}, undefined, 1048576).root,
  ).toEqual(prepareNoiseOctree(input).root);
  for (const invalid of [0, -1, NaN, Infinity, 0.5, 512 * 1048576 + 1])
    expect(() =>
      prepareNoiseOctree(input, 0.5, 10, {}, undefined, invalid),
    ).toThrow("memory budget is invalid");
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    prepareNativeAlignmentTarget(wide, { signal: controller.signal }),
  ).toThrow(/cancelled/);
});

it("shares completed Float32 render normals with encoding workers without detaching model buffers", () => {
  vi.stubGlobal("crossOriginIsolated", true);
  try {
    const source = new Float32Array([1, -0, 0, 0, 1, 0, 0, 0, 1]);
    const normals = indexedRenderNormals({
      ...wide,
      vertices: wide.coordinates,
      triangles: new Uint32Array([0, 1, 2]),
      normals: source,
    }) as Float32Array;
    expect(normals.buffer).toBeInstanceOf(SharedArrayBuffer);
    const cloned = structuredClone(normals);
    expect(cloned.buffer).toBeInstanceOf(SharedArrayBuffer);
    // Shared backing, not merely equal values in a second allocation.
    new Float32Array(cloned.buffer)[0] = 7;
    expect(normals[0]).toBe(7);
    expect(source[0]).toBe(1);
    expect(Object.is(normals[1], -0)).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
