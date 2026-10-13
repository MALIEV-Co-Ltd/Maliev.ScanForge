import { afterEach, expect, it, vi } from "vitest";
import { editPointCloud } from "../src/point-cloud-processing";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";

afterEach(() => vi.unstubAllGlobals());
const positions = new Float32Array([0, 0, 0, 0.1, 0, 0, 1, 0, 0, 1.1, 0, 0]);
const normals = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, -1, 0, 0]);
it("deletes and extracts selected XYZ samples with matching normals and original slots", () => {
  const selection = Uint8Array.from([0, 1, 0, 1]);
  const removed = editPointCloud({
    kind: "pointCloudEdit",
    action: "delete",
    positions,
    normals,
    selection,
  });
  const copied = editPointCloud({
    kind: "pointCloudEdit",
    action: "extract",
    positions,
    normals,
    selection,
  });
  expect(Array.from(removed.positions!)).toEqual([0, 0, 0, 1, 0, 0]);
  expect(Array.from(removed.normals!)).toEqual([1, 0, 0, 0, 0, 1]);
  expect(Array.from(copied.sourceIndices!)).toEqual([1, 3]);
  expect(Array.from(copied.normals!)).toEqual([0, 1, 0, -1, 0, 0]);
  expect(positions).toHaveLength(12);
  expect(
    editPointCloud({
      kind: "pointCloudEdit",
      action: "delete",
      positions,
      selection: new Uint8Array(4).fill(1),
    }).positions,
  ).toHaveLength(0);
});
it("voxel thinning retains real scanner samples, normals and unselected points", () => {
  const result = editPointCloud({
    kind: "pointCloudEdit",
    action: "voxel",
    positions,
    normals,
    cellSize: 0.5,
    selection: Uint8Array.from([1, 1, 0, 0]),
  });
  expect(Array.from(result.sourceIndices!)).toEqual([0, 2, 3]);
  expect(Array.from(result.normals!)).toEqual([1, 0, 0, 0, 0, 1, -1, 0, 0]);
});
it("point-count thinning reaches the requested editable count without changing fixed samples", () => {
  const result = editPointCloud({
    kind: "pointCloudEdit",
    action: "sampleCount",
    positions,
    normals,
    targetPoints: 1,
    selection: Uint8Array.from([1, 1, 0, 0]),
  });
  expect(Array.from(result.sourceIndices!)).toEqual([0, 2, 3]);
  expect(result.diagnostics.removedPoints).toBe(1);
});
it("radius connectivity grows transitively and does not jump disconnected clusters", () => {
  const chain = new Float32Array([0, 0, 0, 0.1, 0, 0, 0.2, 0, 0, 2, 0, 0]);
  const result = editPointCloud({
    kind: "pointCloudEdit",
    action: "connectedSelection",
    positions: chain,
    selection: Uint8Array.from([1, 0, 0, 0]),
    neighborRadius: 0.15,
  });
  expect(Array.from(result.selection!)).toEqual([1, 1, 1, 0]);
  const grown = editPointCloud({
    kind: "pointCloudEdit",
    action: "grow",
    positions: chain,
    selection: Uint8Array.from([1, 0, 0, 0]),
    neighborRadius: 0.15,
  });
  expect(Array.from(grown.selection!)).toEqual([1, 1, 0, 0]);
  const shrunk = editPointCloud({
    kind: "pointCloudEdit",
    action: "shrink",
    positions: chain,
    selection: Uint8Array.from([1, 1, 0, 0]),
    neighborRadius: 0.15,
  });
  expect(Array.from(shrunk.selection!)).toEqual([1, 0, 0, 0]);
});
it("multiple selected smoothing iterations reduce an outlier and clamp total original displacement", () => {
  const cloud = new Float32Array([
    0, 0, 0, -0.1, 0, 0, 0.1, 0, 0, 0, 0.1, 0, 0, 0, 0.2,
  ]);
  const result = editPointCloud({
    kind: "pointCloudEdit",
    action: "smooth",
    positions: cloud,
    selection: Uint8Array.from([0, 0, 0, 0, 1]),
    iterations: 5,
    neighborRadius: 0.5,
    strength: 0.8,
    deviation: 0.05,
  });
  expect(Array.from(result.positions!.slice(0, 12))).toEqual(
    Array.from(cloud.slice(0, 12)),
  );
  expect(result.positions![14]).toBeLessThan(cloud[14]);
  expect(
    Math.hypot(
      result.positions![12] - cloud[12],
      result.positions![13] - cloud[13],
      result.positions![14] - cloud[14],
    ),
  ).toBeLessThanOrEqual(0.05000001);
  expect(result.diagnostics.iterations).toBe(5);
});
it("rejects invalid masks, normals, counts and neighborhood settings before editing", () => {
  expect(() =>
    editPointCloud({
      kind: "pointCloudEdit",
      action: "delete",
      positions,
      selection: new Uint8Array(1),
    }),
  ).toThrow("one slot");
  expect(() =>
    editPointCloud({
      kind: "pointCloudEdit",
      action: "voxel",
      positions,
      normals: [1],
      cellSize: 0.5,
    }),
  ).toThrow("normals");
  expect(() =>
    editPointCloud({
      kind: "pointCloudEdit",
      action: "sampleCount",
      positions,
      targetPoints: 5,
    }),
  ).toThrow("editable point count");
  expect(() =>
    editPointCloud({
      kind: "pointCloudEdit",
      action: "smooth",
      positions,
      neighborRadius: 0,
    }),
  ).toThrow("positive");
});
it("dispatches point editing through the real shared worker without triangle topology", async () => {
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      ((event: { data: ProcessingRequest }) => Promise<void>) | null,
    postMessage: (message: ProcessingResponse) => replies.push(message),
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("../src/processing-worker");
  await scope.onmessage!({
    data: {
      kind: "pointCloudEdit",
      action: "delete",
      positions,
      normals,
      selection: Uint8Array.from([0, 1, 0, 0]),
    },
  });
  const reply = replies.at(-1)!;
  if (!("result" in reply)) throw Error(JSON.stringify(reply));
  expect(reply.result.pointCloudEdit!.positions).toHaveLength(9);
  expect(reply.result.pointCloudEdit!.normals).toHaveLength(9);
  expect(reply.result.topology).toBeUndefined();
  expect(
    replies.some((row) => "stage" in row && /weld|topology/i.test(row.stage)),
  ).toBe(false);
});
