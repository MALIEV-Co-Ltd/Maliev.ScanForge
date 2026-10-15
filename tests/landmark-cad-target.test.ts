import { expect, it, vi } from "vitest";
import {
  beginLandmarkAlignment,
  pickLandmark,
  prepareLandmarkRequest,
  prepareLandmarkRefinementTargets,
} from "../src/landmark-alignment";
import { indexedMeshMatches } from "../src/indexed-mesh";
import type { Entity, IndexedMesh, Vec3 } from "../src/types";

const mesh: IndexedMesh = {
  vertices: [0, 0, 0, 2, 0, 0, 0, 2, 0],
  triangles: [0, 1, 2],
};
const moving: Entity = {
  id: "scan",
  name: "Scan",
  kind: "mesh",
  positions: [...mesh.vertices],
  indexedMesh: mesh,
  color: "#aaa",
  opacity: 1,
  visible: true,
};
const fixed: Entity = {
  ...moving,
  id: "cad",
  name: "CAD",
  kind: "cad",
  kernelId: "exact-body",
  indexedMesh: undefined,
};

it("acquires CAD fixed geometry without modifying its BRep or render buffers", async () => {
  const acquire = vi.fn(async () => mesh);
  const request = await prepareLandmarkRefinementTargets(
    moving,
    [fixed],
    acquire,
  );
  expect(acquire).toHaveBeenCalledExactlyOnceWith("exact-body");
  const target = request.refinementTargets[0];
  expect(target.indexedMesh).toBe(mesh);
  expect(indexedMeshMatches(target.indexedMesh, target.positions)).toBe(true);
  expect(fixed.kernelId).toBe("exact-body");
  expect(fixed.indexedMesh).toBeUndefined();
  expect(fixed.positions).toBe(moving.positions);
});

it("prepares the same CAD-backed picked-point request for GUI and agents", async () => {
  let session = beginLandmarkAlignment(moving, fixed);
  for (const point of [
    [0, 0, 0],
    [2, 0, 0],
    [0, 2, 0],
  ] as Vec3[]) {
    session = pickLandmark(session, moving.id, point);
    session = pickLandmark(session, fixed.id, point);
  }
  const request = await prepareLandmarkRequest(session, async () => mesh, {
    workerCount: 2,
    parallel: true,
  });
  expect(request.refinementTargets?.[0].indexedMesh).toBe(mesh);
  expect(request.sourceIndexed).toBe(moving.indexedMesh);
  expect(request.sourceLandmarks).toEqual(request.targetLandmarks);
});

it("cancels after CAD acquisition before publishing a processing request", async () => {
  const controller = new AbortController();
  await expect(
    prepareLandmarkRefinementTargets(
      moving,
      [fixed],
      async () => {
        controller.abort();
        return mesh;
      },
      2,
      true,
      { signal: controller.signal },
    ),
  ).rejects.toThrow();
});

it("checks the revision again after the asynchronous kernel boundary", async () => {
  let changed = false;
  await expect(
    prepareLandmarkRefinementTargets(
      moving,
      [fixed],
      async () => {
        changed = true;
        return mesh;
      },
      2,
      true,
      {
        check: () => {
          if (changed) throw new Error("stale revision");
        },
      },
    ),
  ).rejects.toThrow("stale revision");
});

it("does not enter the CAD worker for raw indexed targets", async () => {
  const acquire = vi.fn(async () => mesh);
  await prepareLandmarkRefinementTargets(
    moving,
    [{ ...moving, id: "fixed" }],
    acquire,
  );
  expect(acquire).not.toHaveBeenCalled();
});

it("rejects a CAD moving body before kernel acquisition", async () => {
  const acquire = vi.fn(async () => mesh);
  await expect(
    prepareLandmarkRefinementTargets(fixed, [moving], acquire),
  ).rejects.toThrow("moving scan");
  expect(acquire).not.toHaveBeenCalled();
});

it("rejects an unindexed moving scan before requesting CAD geometry", async () => {
  const acquire = vi.fn(async () => mesh);
  await expect(
    prepareLandmarkRefinementTargets(
      { ...moving, indexedMesh: undefined },
      [fixed],
      acquire,
    ),
  ).rejects.toThrow("moving scan");
  expect(acquire).not.toHaveBeenCalled();
});
