import { expect, it } from "vitest";
import {
  projectEncodingSnapshot,
  restoreEncodingSnapshot,
} from "../src/project-encoding-snapshot";
import {
  cloudPlacement,
  cloudPoseBits,
  placedCloud,
} from "../src/point-cloud-placement";
import {
  encodeProjectFileLocally,
  decodeProjectFile,
  type ProjectSession,
} from "../src/project-file";
import type { Entity } from "../src/types";

it("preserves native cloud poses, lazy coordinates and shared history through worker cloning", async () => {
  const base: Entity = {
    id: "cloud",
    name: "Cloud",
    kind: "pointcloud",
    positions: new Float32Array([-0, 2, 3, 4, 5, 6]),
    visible: true,
    opacity: 1,
    color: "#ffffff",
  };
  const placement = {
    sourcePositions: base.positions,
    matrixBits: cloudPoseBits([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30]),
  };
  const cloud = placedCloud(base, placement);
  const snapshot: ProjectSession = {
    project: {
      format: "maliev-scanforge",
      version: 1,
      name: "Cloud",
      units: "mm",
      entities: [cloud],
    },
    history: [{ label: "Import", entities: [cloud] }],
    future: [],
  };
  Object.defineProperty(cloud, "positions", {
    configurable: true,
    enumerable: true,
    get() {
      throw Error("World geometry must remain lazy");
    },
  });
  const wire = projectEncodingSnapshot(snapshot);
  expect(wire.session.project.entities[0].positions).toBe(base.positions);
  expect(wire.session.history[0].entities[0]).toBe(
    wire.session.project.entities[0],
  );
  const restored = restoreEncodingSnapshot(structuredClone(wire));
  expect(cloudPlacement(restored.project.entities[0])?.matrixBits).toBe(
    placement.matrixBits,
  );
  const file = await encodeProjectFileLocally(restored);
  const expected = await encodeProjectFileLocally({
    ...snapshot,
    project: { ...snapshot.project, entities: [placedCloud(base, placement)] },
    history: [{ label: "Import", entities: [placedCloud(base, placement)] }],
  });
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(
    new Uint8Array(await expected.arrayBuffer()),
  );
  const decoded = await decodeProjectFile(file);
  expect(cloudPlacement(decoded.project.entities[0])?.matrixBits).toBe(
    placement.matrixBits,
  );
  expect(decoded.project.entities[0].positions).toEqual(
    new Float32Array([10, 22, 33, 14, 25, 36]),
  );
});

it("retains stale placement for the original validator to reject instead of reviving it", async () => {
  const cloud = {
    id: "x",
    name: "Cloud",
    visible: true,
    opacity: 1,
    color: "#ffffff",
    kind: "pointcloud",
    positions: new Float32Array([9, 9, 9]),
    pointCloudPlacement: {
      sourcePositions: new Float32Array([1, 2, 3]),
      matrixBits: cloudPoseBits([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]),
    },
  } as Entity;
  const wire = projectEncodingSnapshot({
    project: {
      format: "maliev-scanforge",
      version: 1,
      name: "Invalid",
      units: "mm",
      entities: [cloud],
    },
    history: [],
    future: [],
  } as unknown as ProjectSession);
  expect(wire.session.project.entities[0].pointCloudPlacement).toBe(
    cloud.pointCloudPlacement,
  );
  expect(wire.localClouds).toEqual([]);
  await expect(
    encodeProjectFileLocally(restoreEncodingSnapshot(structuredClone(wire))),
  ).rejects.toThrow(/disagrees/);
  expect(wire.session.project.entities[0].positions).toBe(cloud.positions);
});
