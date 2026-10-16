import { afterEach, expect, it, vi } from "vitest";
import { createGlobalQueryWorkerState } from "../src/scan-global-query-worker";
import type { NativeGlobalQueryGeometry } from "../src/scan-native-global-query";
import * as adjacency from "../src/scan-native-alignment-adjacency";
import * as surface from "../src/scan-native-global-surface";
import fixture from "./fixtures/global-fine-mesh-correspondence-native.json";
import { meshCorrespondenceFixture } from "./helpers/global-mesh-correspondence-fixture";

afterEach(() => vi.restoreAllMocks());
function shared(
  geometry: NativeGlobalQueryGeometry,
): NativeGlobalQueryGeometry {
  const arrays = new Map<object, any>();
  const copy = <T extends Float32Array | Uint32Array | Uint8Array>(v: T): T => {
    if (arrays.has(v)) return arrays.get(v);
    const result = new (v.constructor as { new (buffer: ArrayBufferLike): T })(
      new SharedArrayBuffer(v.byteLength),
    );
    result.set(v);
    arrays.set(v, result);
    return result;
  };
  return {
    ...geometry,
    points: copy(geometry.points),
    normals: copy(geometry.normals),
    flags: geometry.flags && copy(geometry.flags),
    labels: geometry.labels && copy(geometry.labels),
    targetMeshes: geometry.targetMeshes?.map((m) => ({
      ...m,
      vertices: copy(m.vertices),
      triangles: copy(m.triangles),
      flags: m.flags && copy(m.flags),
    })),
  };
}
const bits = (v: number[]) =>
  Buffer.from(Float64Array.from(v).buffer).toString("hex");
it.each(fixture.cases)(
  "restores shared targets without rebuilding and preserves native bits: $name / $mode",
  (c) => {
    const { scans, job } = meshCorrespondenceFixture(c);
    const first = createGlobalQueryWorkerState({
      scans: scans.map((s) => ({ ...s, geometry: shared(s.geometry) })),
      exportPreparedMeshes: true,
    });
    const payload = structuredClone(first.prepared!);
    const build = vi.spyOn(surface, "prepareNativeGlobalMeshEvaluator");
    const link = vi.spyOn(adjacency, "nativeBuildAlignmentNeighbourMasks");
    const second = createGlobalQueryWorkerState(payload);
    expect(build).not.toHaveBeenCalled();
    expect(link).not.toHaveBeenCalled();
    for (const target of payload.preparedMeshes!.flatMap((s) => s.targets)) {
      for (const array of [
        target.surface.vertices,
        target.surface.triangles,
        target.surface.normals,
        target.surface.bounds,
        target.degenerate,
        target.neighbours,
      ])
        expect(array.buffer).toBeInstanceOf(SharedArrayBuffer);
      const pending = target.root ? [target.root] : [];
      while (pending.length) {
        const node = pending.pop()!;
        if (node.triangles.length)
          expect(node.triangles.buffer).toBeInstanceOf(SharedArrayBuffer);
        for (const child of Object.values(node.children))
          if (child) pending.push(child);
      }
    }
    for (let repeat = 0; repeat < 2; repeat++) {
      const a = first.execute(job),
        b = second.execute(job);
      expect(b).toEqual(a);
      expect(b.count).toBe(c.count);
      expect(
        b.pairs.map((p) => ({
          id: p.id,
          active: p.active,
          numericBits: bits([...p.source, ...p.target, p.distance]),
        })),
      ).toEqual(
        c.results.map((p) => ({
          id: p.id,
          active: p.active,
          numericBits: p.numericBits,
        })),
      );
    }
  },
);
it("rejects mismatched scan identity and damaged target state", () => {
  const { scans } = meshCorrespondenceFixture(fixture.cases[0]);
  const first = createGlobalQueryWorkerState({
    scans: scans.map((s) => ({ ...s, geometry: shared(s.geometry) })),
    exportPreparedMeshes: true,
  });
  const badId = structuredClone(first.prepared!);
  badId.preparedMeshes![0].id = "other";
  expect(() => createGlobalQueryWorkerState(badId)).toThrow(/scan IDs/);
  const damaged = structuredClone(first.prepared!);
  const target = damaged.preparedMeshes!.flatMap((s) => s.targets)[0];
  target.neighbours = new Uint8Array();
  expect(() => createGlobalQueryWorkerState(damaged)).toThrow(/boundary masks/);
  const cycle = structuredClone(first.prepared!);
  const root = cycle
    .preparedMeshes!.flatMap((s) => s.targets)
    .find((t) => t.root)!.root!;
  root.children[0] = root;
  expect(() => createGlobalQueryWorkerState(cycle)).toThrow(/child/);
});
