import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
} from "../src/io";
import {
  decodeProjectContents,
  encodeProjectFileLocally,
} from "../src/project-file-codec";
import type { Entity, Project } from "../src/types";
import { prepareRestoredProjectDisplays } from "../src/restored-scan-display";

const empty = {
  id: "source",
  name: "Source",
  kind: "mesh",
  positions: new Float32Array(),
  visible: true,
  color: "#ffffff",
  opacity: 1,
  emptyComponentSource: true,
} as Entity;
const project = (entity: Entity): Project => ({
  format: "maliev-scanforge",
  version: 1,
  name: "Empty source",
  units: "mm",
  entities: [entity],
});

it("renders an empty source without expanding the scene bounds", () => {
  const view = Object.create(Viewport.prototype) as Viewport;
  const scene = new THREE.Scene(),
    bounds = new THREE.Box3();
  Object.assign(view, {
    selectedId: null,
    objects: new Map(),
    scene,
    bounds,
    grid: new THREE.Object3D(),
    invalidate: vi.fn(),
    theme: "dark",
  });
  const part: Entity = {
    ...empty,
    id: "part",
    emptyComponentSource: undefined,
    positions: [10, 0, 0, 11, 0, 0, 10, 1, 0],
  };
  try {
    view.setEntities([empty, part], empty.id);
    expect(bounds.min.toArray()).toEqual([10, 0, 0]);
    expect(bounds.max.toArray()).toEqual([11, 1, 0]);
    const mesh = scene.children.find(
      (item) => item.userData.entityId === empty.id,
    ) as THREE.Mesh;
    expect(mesh.geometry.getAttribute("position").count).toBe(0);
  } finally {
    view.setEntities([], null);
  }
});

it("round trips an extracted empty source through JSON and binary history", async () => {
  for (const text of [
    serializeProject("Empty", [empty]),
    await (await serializeProjectBlob("Empty", [empty])).text(),
  ]) {
    const result = parseProject(text).entities[0];
    expect(JSON.parse(text).version).toBe(6);
    const older = JSON.parse(text);
    older.version = 5;
    expect(() => parseProject(JSON.stringify(older))).toThrow(/version 6/i);
    expect(result.emptyComponentSource).toBe(true);
    expect(result.positions).toHaveLength(0);
  }
  const blob = await encodeProjectFileLocally({
    project: project(empty),
    history: [{ label: "before", entities: [empty] }],
    future: [{ label: "after", entities: [empty] }],
  });
  const header = new DataView(await blob.slice(0, 16).arrayBuffer());
  const manifestText = await blob
    .slice(16, 16 + header.getUint32(8, true))
    .text();
  const manifest = JSON.parse(manifestText);
  expect(manifest.version).toBe(8);
  const decoded = await decodeProjectContents(blob);
  for (const entity of [
    decoded.project.entities[0],
    decoded.history[0].entities[0],
    decoded.future[0].entities[0],
  ]) {
    expect(entity.emptyComponentSource).toBe(true);
    expect(entity.positions).toHaveLength(0);
  }
  const workerDecoded = await decodeProjectContents(blob, {
    privateFloat64Chunks: true,
    workerFloat64Views: true,
  });
  expect(
    prepareRestoredProjectDisplays(workerDecoded).project.entities[0]
      .emptyComponentSource,
  ).toBe(true);
  const oldManifest = manifestText.replace(
    /("version"\s*:\s*)8/,
    (_, prefix: string) => `${prefix}7`,
  );
  expect(new TextEncoder().encode(oldManifest)).toHaveLength(
    header.getUint32(8, true),
  );
  await expect(
    decodeProjectContents(
      new Blob([
        await blob.slice(0, 16).arrayBuffer(),
        oldManifest,
        blob.slice(16 + header.getUint32(8, true)),
      ]),
    ),
  ).rejects.toThrow();
});

it.each([
  { emptyComponentSource: undefined },
  { emptyComponentSource: false },
  { kind: "pointcloud" },
  { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
  { indexedMesh: { vertices: [0, 0, 0], triangles: [0, 0, 0] } },
  { brep: "stale" },
])("rejects malformed empty source state %j", async (patch) => {
  const candidate = { ...empty, ...patch } as Entity;
  expect(() =>
    parseProject(JSON.stringify({ ...project(candidate), version: 6 })),
  ).toThrow();
  await expect(serializeProjectBlob("Bad", [candidate])).rejects.toThrow();
  await expect(
    encodeProjectFileLocally({
      project: project(candidate),
      history: [],
      future: [],
    }),
  ).rejects.toThrow();
});
