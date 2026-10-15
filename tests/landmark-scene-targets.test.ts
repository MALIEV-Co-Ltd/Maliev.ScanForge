import { expect, it, vi } from "vitest";
import capture from "../docs/evidence/landmark-assembled-target-native.json";
import {
  beginLandmarkAlignment,
  editLandmarks,
  landmarkSceneUnchanged,
  landmarkState,
  prepareLandmarkRequest,
  prepareLandmarkRefinementTargets,
  visibleLandmarkTargets,
} from "../src/landmark-alignment";
import { prepareNativeLandmarkTarget } from "../src/native-landmark-target";
import type { Entity, IndexedMesh, Vec3 } from "../src/types";

const mesh: IndexedMesh = {
  vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  triangles: [0, 1, 2],
};
const moving: Entity = {
  id: "moving",
  name: "Moving",
  kind: "mesh",
  positions: [...mesh.vertices],
  indexedMesh: mesh,
  color: "#aaa",
  visible: true,
  opacity: 1,
};
const fixed: Entity = { ...moving, id: "scan-a", name: "Fixed" };
const other: Entity = { ...moving, id: "scan-b", name: "Other" };
const cad: Entity = {
  ...moving,
  id: "cad",
  name: "CAD",
  kind: "cad",
  indexedMesh: undefined,
  kernelId: "body",
};
const floats = (hex: string) => {
  const b = Buffer.from(hex, "hex");
  return Float32Array.from({ length: b.length / 4 }, (_, i) =>
    b.readFloatLE(i * 4),
  );
};
const bits = (a: Float32Array) =>
  Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("hex");
function picked(
  scene: Entity[],
  targetScope: "fixed" | "visibleScene" = "visibleScene",
) {
  let session = beginLandmarkAlignment(moving, fixed, { scene, targetScope });
  for (const p of [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ] as Vec3[]) {
    session = editLandmarks(session, {
      action: "pick",
      entityId: moving.id,
      point: p,
    });
    session = editLandmarks(session, {
      action: "pick",
      entityId: fixed.id,
      point: p,
    });
  }
  return session;
}

it("prepares visible CAD before visible scans and excludes moving/unsupported objects", async () => {
  const hidden = { ...other, id: "hidden", visible: false };
  const cloud = {
    ...other,
    id: "cloud",
    kind: "pointcloud" as const,
    indexedMesh: undefined,
  };
  const scene = [other, moving, hidden, fixed, cad, cloud];
  const session = picked(scene);
  // Hidden consumers and construction references are needed by root filtering.
  expect(session.refinementScene).toEqual(scene);
  expect(session.refinementScene).not.toBe(scene);
  expect(landmarkState(session)).toHaveProperty("refinementTargetIds", [
    cad.id,
    other.id,
    fixed.id,
  ]);
  const acquire = vi.fn(async () => mesh);
  const request = await prepareLandmarkRequest(session, acquire);
  expect(request.refinementTargets).toHaveLength(3);
  expect(request.refinementTargets?.[1].indexedMesh).toBe(other.indexedMesh);
  expect(acquire).toHaveBeenCalledExactlyOnceWith("body");
  expect(landmarkSceneUnchanged(session, scene)).toBe(true);
  expect(cad.kernelId).toBe("body");
});

it("scope changes discard preview, preserve picks and allow fixed-only refinement", async () => {
  const scene = [moving, fixed, other, cad];
  const session = {
    ...picked(scene),
    preview: { kind: "paired" as const, diagnostics: {} },
  };
  const next = editLandmarks(
    session,
    { action: "target-scope", targetScope: "fixed" },
    scene,
  );
  expect(next.preview).toBeUndefined();
  expect(next.picks).toBe(session.picks);
  expect(landmarkState(next)).toHaveProperty("refinementTargetIds", [fixed.id]);
  const acquire = vi.fn(async () => mesh);
  expect(
    (await prepareLandmarkRequest(next, acquire)).refinementTargets,
  ).toHaveLength(1);
  expect(acquire).not.toHaveBeenCalled();
  expect(landmarkSceneUnchanged(next, [moving, fixed])).toBe(true);
});

it.each(["add", "remove", "reorder", "hide", "geometry", "hidden-facets"])(
  "invalidates scene preview after target %s changes",
  (change) => {
    const scene = [moving, fixed, other, cad];
    const session = picked(scene);
    const after =
      change === "add"
        ? [...scene, { ...other, id: "extra" }]
        : change === "remove"
          ? [moving, fixed, cad]
          : change === "reorder"
            ? [moving, other, fixed, cad]
            : scene.map((e) =>
                e.id !== other.id
                  ? e
                  : change === "hide"
                    ? { ...e, visible: false }
                    : change === "geometry"
                      ? { ...e, positions: [...e.positions] }
                      : { ...e, meshSelection: { hidden: [0], saved: [] } },
              );
    expect(landmarkSceneUnchanged(session, after)).toBe(false);
  },
);

it("read-only additional locked targets remain eligible and appearance changes do not invalidate", () => {
  const scene = [moving, fixed, { ...other, locked: true }];
  const session = picked(scene);
  expect(landmarkState(session)).toHaveProperty("refinementTargetIds", [
    fixed.id,
    other.id,
  ]);
  expect(
    landmarkSceneUnchanged(
      session,
      scene.map((e) => ({ ...e, color: "#123", name: "Renamed" })),
    ),
  ).toBe(true);
});

it.each(capture.cases)(
  "matches assembled native scene $case with $logicalLanes lanes",
  async (row) => {
    const records = new Map(
      capture.cases.flatMap((c) =>
        c.inputs.map((data, i) => [c.targetOrder[i], data] as const),
      ),
    );
    const meshes = new Map(
      Array.from(records, ([name, data]) => [
        name,
        {
          vertices: floats(data.positionBits),
          normals: floats(data.normalBits),
          triangles: Uint32Array.from(data.triangleIds),
        },
      ]),
    );
    const scan = (name: string, index: number): Entity => {
      const m = meshes.get(name === "hidden" ? "scan-b" : name) ?? mesh;
      return {
        ...moving,
        id: name === "moving" ? name : `${index}-${name}`,
        name,
        indexedMesh: name === "unsupported" ? undefined : m,
        kind: name === "unsupported" ? "pointcloud" : "mesh",
        visible: name !== "hidden",
        positions: Array.from(m.triangles, (id) =>
          Array.from(m.vertices.slice(id * 3, id * 3 + 3)),
        ).flat(),
      };
    };
    const scene = row.scanRoots.flatMap((name, index) =>
      name === null ? [] : [scan(name, index)],
    );
    row.cadRoots.forEach((root, i) => {
      const names =
        root === "both"
          ? ["cad-box", "cad-cylinder"]
          : root === "direct"
            ? ["cad-box"]
            : root === "hidden-cad"
              ? ["cad-cylinder"]
              : [];
      for (const name of names)
        scene.push({
          ...cad,
          id: `${i}-${name}`,
          name,
          kernelId: name,
          visible: root !== "hidden-cad",
        });
    });
    const selected = visibleLandmarkTargets(moving, scene);
    expect(selected.map((e) => e.name)).toEqual(row.targetOrder);
    if (!row.joined) {
      expect(selected).toEqual([]);
      return;
    }
    const request = await prepareLandmarkRefinementTargets(
      moving,
      selected,
      async (id) => meshes.get(id)!,
    );
    const joined = prepareNativeLandmarkTarget(
      request.refinementTargets.map((target) => target.indexedMesh),
    );
    expect(bits(joined.vertices)).toBe(row.joined.positionBits);
    expect(bits(joined.normals)).toBe(row.joined.normalBits);
    expect(Array.from(joined.triangles)).toEqual(row.joined.triangleIds);
  },
);
