import { expect, it, vi } from "vitest";
import { createDatumTransformExecutor } from "../src/datum-transform-pool";
import { cloudPlacement } from "../src/point-cloud-placement";
import { cloudPoseBits, placedCloud } from "../src/point-cloud-placement";
import { seekModelRevision } from "../src/history";
import type { Entity, Positions } from "../src/types";
import {
  encodeProjectFileLocally,
  decodeProjectFile,
} from "../src/project-file";
import {
  projectEncodingSnapshot,
  restoreEncodingSnapshot,
} from "../src/project-encoding-snapshot";

function bytes(values: Positions) {
  const view =
    values instanceof Float32Array ? values : Float64Array.from(values);
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString(
    "hex",
  );
}

async function editManifest(file: Blob, edit: (manifest: any) => void) {
  const raw = Buffer.from(await file.arrayBuffer());
  const length = raw.readUInt32LE(8);
  const manifest = JSON.parse(raw.subarray(16, 16 + length).toString("utf8"));
  edit(manifest);
  const encoded = Buffer.from(JSON.stringify(manifest));
  const header = Buffer.from(raw.subarray(0, 16));
  header.writeUInt32LE(encoded.length, 8);
  return new Blob([header, encoded, raw.subarray(16 + length)]);
}

it("keeps old cloud files without carrier metadata on their legacy array fallback and rejects malformed metadata", async () => {
  const source: Entity = {
    id: "cloud",
    name: "Cloud",
    kind: "pointcloud",
    positions: new Float32Array([1, 2, 3]),
    normals: new Float32Array([-0, -0, -0]),
    color: "#aaaaaa",
    visible: true,
    opacity: 1,
  };
  const pose = {
    matrixBits: cloudPoseBits([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]),
    sourcePositions: source.positions,
    sourceNormals: source.normals,
  };
  const cloud = placedCloud(source, pose, {
    positions: source.positions as Float32Array,
    normals: source.normals,
  });
  const file = await encodeProjectFileLocally({
    project: {
      format: "maliev-scanforge",
      version: 1,
      name: "Legacy",
      units: "mm",
      entities: [cloud],
    },
    history: [],
    future: [],
  });
  const legacy = await decodeProjectFile(
    await editManifest(file, (manifest) => {
      expect(manifest.version).toBe(3);
      expect(manifest.records[0].cloudNormalsTyped).toBe(true);
      delete manifest.records[0].cloudNormalsTyped;
    }),
  );
  expect(Array.isArray(legacy.project.entities[0].normals)).toBe(true);
  expect(legacy.project.entities[0].normals).toEqual(
    Array.from(source.normals!),
  );
  await expect(
    decodeProjectFile(
      await editManifest(file, (manifest) => {
        manifest.records[0].cloudNormalsTyped = "f32";
      }),
    ),
  ).rejects.toThrow(/Invalid|damaged/);
});

it.each([
  { localTyped: true, worldTyped: true },
  { localTyped: true, worldTyped: false },
  { localTyped: false, worldTyped: true },
  { localTyped: false, worldTyped: false },
])(
  "retains the seeded normal carrier after cache eviction and history seek: %j",
  async ({ localTyped, worldTyped }) => {
    let expired = false;
    // Deterministic cache misses exercise the same path as reclaimed historical views.
    vi.stubGlobal(
      "WeakRef",
      class<T extends object> {
        constructor(private value: T) {}
        deref() {
          return expired ? undefined : this.value;
        }
      },
    );
    const positions = new Float32Array([3, 4, 5, -6, 7, 8]);
    const values = [-0, -0, -0, 0.123456789, -0.987654321, 0.333333333];
    const normals: Positions = localTyped ? Float32Array.from(values) : values;
    const source: Entity = {
      id: "original-cloud",
      name: "Original cloud",
      kind: "pointcloud",
      positions,
      normals,
      color: "#aaaaaa",
      visible: true,
      opacity: 1,
    };
    const localBefore = bytes(normals);
    const executor = createDatumTransformExecutor({
      parallel: false,
      typedNormals: worldTyped,
    });

    try {
      const first = (
        await executor.transformScan(
          source,
          [0, -1, 0, 3, 1, 0, 0, 4, 0, 0, 1, 5],
        )
      ).entity;
      const firstNormals = bytes(first.normals!);
      const firstPositions = bytes(first.positions);
      expect(first.normals instanceof Float32Array).toBe(worldTyped);
      const second = (
        await executor.transformScan(
          first,
          [1, 0, 0, 7, 0, 1, 0, 8, 0, 0, 1, 9],
        )
      ).entity;
      const secondNormals = bytes(second.normals!);
      const secondPositions = bytes(second.positions);
      const firstPose = cloudPlacement(first)!.matrixBits;
      const secondPose = cloudPlacement(second)!.matrixBits;
      expired = true;
      const undone = seekModelRevision(
        [{ entities: [first], label: "Second pose" }],
        [second],
        [],
        0,
      );
      const restored = undone.entities[0];
      expect(restored.normals instanceof Float32Array).toBe(worldTyped);
      expect(bytes(restored.normals!)).toBe(firstNormals);
      expect(bytes(restored.positions)).toBe(firstPositions);
      expect(cloudPlacement(restored)!.matrixBits).toBe(firstPose);
      expect(cloudPlacement(restored)!.sourcePositions).toBe(positions);
      expect(cloudPlacement(restored)!.sourceNormals).toBe(normals);
      expired = false;
      const redone = seekModelRevision(
        undone.history,
        undone.entities,
        undone.future,
        1,
      ).entities[0];
      expect(redone.normals instanceof Float32Array).toBe(worldTyped);
      expect(bytes(redone.normals!)).toBe(secondNormals);
      expect(bytes(redone.positions)).toBe(secondPositions);
      expect(cloudPlacement(redone)!.matrixBits).toBe(secondPose);
      expect(bytes(normals)).toBe(localBefore);
    } finally {
      executor.close();
      vi.unstubAllGlobals();
    }
  },
);

it.each([
  { localTyped: true, worldTyped: false },
  { localTyped: false, worldTyped: true },
  { localTyped: true, worldTyped: true },
])(
  "retains distinct local/world normal carriers across worker snapshots and project history: %j",
  async ({ localTyped, worldTyped }) => {
    const normals: Positions = localTyped
      ? new Float32Array([-0, -0, -0, 0.123456789, 0.75, -0.5])
      : [-0, -0, -0, 0.123456789, 0.75, -0.5];
    const source: Entity = {
      id: "cloud",
      name: "Cloud",
      kind: "pointcloud",
      positions: new Float32Array([1, 2, 3, 4, 5, 6]),
      normals,
      visible: true,
      opacity: 1,
      color: "#aaaaaa",
    };
    const executor = createDatumTransformExecutor({
      parallel: false,
      typedNormals: worldTyped,
    });
    try {
      const first = (
        await executor.transformScan(
          source,
          [1, 0, 0, 3, 0, 1, 0, 4, 0, 0, 1, 5],
        )
      ).entity;
      const second = (
        await executor.transformScan(
          first,
          [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
        )
      ).entity;
      const expected = [first, second].map((cloud) => ({
        world: bytes(cloud.normals!),
        local: bytes(cloudPlacement(cloud)!.sourceNormals!),
        positions: bytes(cloud.positions),
        pose: cloudPlacement(cloud)!.matrixBits,
      }));
      const session = {
        project: {
          format: "maliev-scanforge" as const,
          version: 1 as const,
          name: "Carriers",
          units: "mm" as const,
          entities: [second],
        },
        history: [{ label: "Pose", entities: [first] }],
        future: [],
      };
      const snapshot = restoreEncodingSnapshot(
        structuredClone(projectEncodingSnapshot(session)),
      );
      const check = (entities: Entity[]) =>
        entities.forEach((cloud, i) => {
          expect(cloud.normals instanceof Float32Array).toBe(worldTyped);
          expect(
            cloudPlacement(cloud)!.sourceNormals instanceof Float32Array,
          ).toBe(localTyped);
          expect(bytes(cloud.normals!)).toBe(expected[i].world);
          expect(bytes(cloudPlacement(cloud)!.sourceNormals!)).toBe(
            expected[i].local,
          );
          expect(bytes(cloud.positions)).toBe(expected[i].positions);
          expect(cloudPlacement(cloud)!.matrixBits).toBe(expected[i].pose);
        });
      check([snapshot.history[0].entities[0], snapshot.project.entities[0]]);
      for (const state of [session, snapshot]) {
        const reopened = await decodeProjectFile(
          await encodeProjectFileLocally(state),
        );
        check([reopened.history[0].entities[0], reopened.project.entities[0]]);
        const undone = seekModelRevision(
          reopened.history,
          reopened.project.entities,
          reopened.future,
          0,
        );
        check([undone.entities[0], undone.future[0].entities[0]]);
      }
    } finally {
      executor.close();
    }
  },
);
