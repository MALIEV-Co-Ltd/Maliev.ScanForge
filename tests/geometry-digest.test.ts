import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { digestEntityGeometry } from "../src/geometry-digest";
import { priorityScanPreparationCount } from "../src/scan-background-preparation";
import type { Entity } from "../src/types";
const entity = (positions: Entity["positions"] = []) =>
  ({
    id: "scan",
    positions,
    color: "#fff",
    visible: true,
    opacity: 1,
  }) as Entity;
function hash(values: number[], type: "f32" | "f64" | "u32") {
  const width = type === "f64" ? 8 : 4,
    b = Buffer.alloc(values.length * width);
  values.forEach((v, i) =>
    type === "u32"
      ? b.writeUInt32LE(v, i * width)
      : type === "f32"
        ? b.writeFloatLE(v, i * width)
        : b.writeDoubleLE(v, i * width),
  );
  return createHash("sha256").update(b).digest("hex");
}
describe("canonical entity geometry digest", () => {
  it("holds a foreground preparation lease during hashing and releases it on cancellation", async () => {
    const baseline = priorityScanPreparationCount();
    const controller = new AbortController();
    const pending = digestEntityGeometry(entity(new Float32Array([0, 1, 2])), {
      signal: controller.signal,
    });
    expect(priorityScanPreparationCount()).toBe(baseline + 1);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(priorityScanPreparationCount()).toBe(baseline);
  });
  it("hashes F32 signed zero and F64 arrays using independent canonical bytes", async () => {
    const e = entity(new Float32Array([1, -0, 2.5]));
    e.normals = [0, -0, 1];
    const r = await digestEntityGeometry(e);
    expect(r.entityId).toBe("scan");
    expect(r.units).toBe("mm");
    expect(
      r.buffers.map((b) => [
        b.path,
        b.encoding,
        b.elements,
        b.rawBytes,
        b.sha256,
      ]),
    ).toEqual([
      ["positions", "f32", 3, 12, hash([1, -0, 2.5], "f32")],
      ["normals", "f64", 3, 24, hash([0, -0, 1], "f64")],
    ]);
    expect(Object.is(e.positions[1], -0)).toBe(true);
  });
  it("encodes restored number-array triangle indices as u32 in fixed order", async () => {
    const e = entity([1, 2, 3]);
    e.indexedMesh = {
      vertices: new Float32Array([1, 2, 3]),
      triangles: [0, 1, 4294967295],
      normals: new Float32Array([0, 0, 1]),
    };
    e.edgePositions = [0, 1];
    e.pointCloudPlacement = {
      matrixBits: "opaque-pose",
      sourcePositions: new Float32Array([4, 5, 6]),
      sourceNormals: [1, 0, 0],
    };
    const before = structuredClone(e),
      r = await digestEntityGeometry(e);
    expect(r.buffers.map((b) => b.path)).toEqual([
      "positions",
      "indexedMesh.vertices",
      "indexedMesh.triangles",
      "indexedMesh.normals",
      "edgePositions",
      "pointCloudPlacement.sourcePositions",
      "pointCloudPlacement.sourceNormals",
    ]);
    expect(r.buffers[2]).toMatchObject({
      encoding: "u32",
      rawBytes: 12,
      sha256: hash([0, 1, 4294967295], "u32"),
    });
    expect(r.pointCloudMatrixBits).toBe("opaque-pose");
    expect(e).toEqual(before);
  });
  it("reports real backing aliases and subarray offsets including SAB", async () => {
    const shared = new SharedArrayBuffer(32),
      a = new Float32Array(shared, 4, 3),
      e = entity(a);
    e.normals = new Float32Array(shared, 8, 3);
    e.edgePositions = [1, 2];
    e.pointCloudPlacement = {
      matrixBits: "pose",
      sourcePositions: e.edgePositions,
    };
    const r = await digestEntityGeometry(e);
    expect(r.buffers[0]).toMatchObject({
      storage: "shared-array-buffer",
      shared: true,
      byteOffset: 4,
      backingBytes: 32,
    });
    expect(r.buffers[1].backingId).toBe(r.buffers[0].backingId);
    expect(r.buffers[2].backingId).not.toBe(r.buffers[0].backingId);
    expect(r.buffers[3].backingId).toBe(r.buffers[2].backingId);
    expect(r.buffers[2].storage).toBe("number-array");
  });
  it("hashes empty mandatory/optional arrays without inventing absent fields", async () => {
    const e = entity();
    e.normals = [];
    const r = await digestEntityGeometry(e);
    expect(r.buffers).toHaveLength(2);
    r.buffers.forEach((b) =>
      expect(b).toMatchObject({
        elements: 0,
        rawBytes: 0,
        sha256: hash([], "f64"),
        shared: false,
      }),
    );
    expect(r.pointCloudMatrixBits).toBeUndefined();
  });
  it("reports ordinary backing views and hashes typed u32 indices", async () => {
    const e = entity(new Float32Array([0, 1, 2]));
    e.normals = e.positions;
    e.indexedMesh = {
      vertices: e.positions,
      triangles: new Uint32Array([0, 1, 2]),
    };
    const r = await digestEntityGeometry(e);
    expect(r.buffers[0]).toMatchObject({
      storage: "array-buffer",
      shared: false,
      byteOffset: 0,
      backingBytes: 12,
    });
    expect(r.buffers[0].backingId).toBe(r.buffers[1].backingId);
    expect(r.buffers[0].backingId).toBe(r.buffers[2].backingId);
    expect(r.buffers[3].sha256).toBe(hash([0, 1, 2], "u32"));
    expect(r.buffers[3].backingId).not.toBe(r.buffers[0].backingId);
  });
  it("finishes with monotonic progress in at most 1MiB increments", async () => {
    const e = entity(new Float32Array(600000)),
      progress: number[] = [];
    await digestEntityGeometry(e, { onProgress: (p) => progress.push(p) });
    expect(progress).toHaveLength(3);
    expect(progress.at(-1)).toBe(1);
    let previous = 0;
    for (const p of progress) {
      expect(p).toBeGreaterThan(previous);
      expect((p - previous) * 2400000).toBeLessThanOrEqual(1024 * 1024 + 1e-8);
      previous = p;
    }
    expect(e.positions.every((v) => v === 0)).toBe(true);
  });
  it("rejects NaN already stored in a Float32 carrier", async () => {
    await expect(
      digestEntityGeometry(entity(new Float32Array([NaN]))),
    ).rejects.toThrow(/finite/);
  });
  it.each([-1, 1.2, 4294967296, NaN, Infinity])(
    "rejects invalid triangle scalar %s without wrapping",
    async (value) => {
      const e = entity();
      e.indexedMesh = { vertices: [], triangles: [value] };
      await expect(digestEntityGeometry(e)).rejects.toThrow(
        /triangle|u32|index/i,
      );
    },
  );
  it.each([NaN, Infinity, -Infinity, "1", undefined])(
    "rejects nonfinite/nonnumeric coordinate %s",
    async (value) => {
      await expect(
        digestEntityGeometry(entity([value] as number[])),
      ).rejects.toThrow(/finite|number|numeric/i);
    },
  );
  it("accepts finite double extrema and preserves signed zero", async () => {
    const values = [
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      0,
      -0,
      Number.MIN_VALUE,
    ];
    const result = await digestEntityGeometry(entity(values));
    const expected = new ArrayBuffer(values.length * 8);
    const view = new DataView(expected);
    values.forEach((value, index) => view.setFloat64(index * 8, value, true));
    expect(result.buffers[0].sha256).toBe(
      createHash("sha256").update(Buffer.from(expected)).digest("hex"),
    );
  });
  it("yields after bounded 1MiB chunks and honors abort before publishing", async () => {
    const e = entity(new Float32Array(600000)),
      controller = new AbortController(),
      progress: number[] = [];
    const pending = digestEntityGeometry(e, {
      signal: controller.signal,
      onProgress: (p) => {
        progress.push(p);
        if (progress.length === 1) setTimeout(() => controller.abort(), 0);
      },
    });
    await expect(pending).rejects.toThrow(/abort/i);
    expect(progress.length).toBe(1);
    expect(progress[0] * e.positions.length * 4).toBeLessThanOrEqual(
      1024 * 1024,
    );
  });
  it("checks after progress callbacks and invokes final ownership check", async () => {
    let checks = 0;
    const e = entity([1]);
    const r = await digestEntityGeometry(e, {
      check: () => {
        checks++;
      },
    });
    expect(checks).toBeGreaterThanOrEqual(3);
    expect(r.buffers[0].sha256).toBe(hash([1], "f64"));
    const c = new AbortController();
    await expect(
      digestEntityGeometry(e, {
        signal: c.signal,
        onProgress: () => c.abort(),
      }),
    ).rejects.toThrow(/abort/i);
  });
  it("propagates check/progress failures and pre-aborted signals", async () => {
    const e = entity([1]);
    await expect(
      digestEntityGeometry(e, {
        check: () => {
          throw Error("stale");
        },
      }),
    ).rejects.toThrow("stale");
    await expect(
      digestEntityGeometry(e, {
        onProgress: () => {
          throw Error("callback");
        },
      }),
    ).rejects.toThrow("callback");
    const c = new AbortController();
    c.abort();
    await expect(digestEntityGeometry(e, { signal: c.signal })).rejects.toThrow(
      /abort/i,
    );
  });
});
