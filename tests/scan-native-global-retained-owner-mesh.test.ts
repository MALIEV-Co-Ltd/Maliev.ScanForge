import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { freemem } from "node:os";
import fixture from "./fixtures/global-fine-retained-owner-mesh-native.json";
import type { NativeGlobalEvaluatorMesh } from "../src/scan-native-global-surface";
import {
  prepareNativeGlobalMeshTargetSet,
  nativeGlobalMeshTargetData,
  installNativeGlobalMeshTarget,
} from "../src/scan-native-global-mesh-target";
const directory = process.env.SCANFORGE_NATIVE_OWNER_MESH;
const hash = (bytes: ArrayBufferView) =>
  createHash("sha256")
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest("hex");
const bits = (v: ArrayLike<number>) =>
  Buffer.from(Float64Array.from(v).buffer).toString("hex");
it.skipIf(!directory).each([false, true])(
  "matches full original retained-owner mesh index, normals, boundaries and Double queries; shared restore=%s",
  (shared) => {
    if (freemem() < 3072 * 1048576)
      throw Error("Retained owner mesh replay requires 3072 MiB free.");
    const c = fixture.cases[0];
    const vb = readFileSync(resolve(directory!, c.verticesCarrier)),
      tb = readFileSync(resolve(directory!, c.trianglesCarrier));
    expect(hash(vb)).toBe(c.verticesSha256);
    expect(hash(tb)).toBe(c.trianglesSha256);
    let input: NativeGlobalEvaluatorMesh = {
      vertices: new Float32Array(vb.buffer, vb.byteOffset, vb.length / 4),
      triangles: new Uint32Array(tb.buffer, tb.byteOffset, tb.length / 4),
      minimumExtent: c.minimumExtent,
    };
    if (shared) {
      const vertices = new Float32Array(
        new SharedArrayBuffer(input.vertices.byteLength),
      );
      const triangles = new Uint32Array(
        new SharedArrayBuffer(input.triangles.byteLength),
      );
      vertices.set(input.vertices);
      triangles.set(input.triangles);
      input = { ...input, vertices, triangles };
    }
    expect(input.vertices.length / 3).toBe(c.vertices);
    expect(input.triangles.length / 3).toBe(c.triangles);
    const started = performance.now(),
      deadline = started + 90000;
    let maxHeap = 0,
      maxArrays = 0,
      last = 0,
      lowMemory = false;
    const signal = {
      get aborted() {
        const now = performance.now();
        if (now - last > 100) {
          const m = process.memoryUsage();
          maxHeap = Math.max(maxHeap, m.heapUsed);
          maxArrays = Math.max(maxArrays, m.arrayBuffers);
          last = now;
          lowMemory = freemem() < 1024 * 1048576;
        }
        return now > deadline || lowMemory;
      },
    } as AbortSignal;
    if (shared) {
      prepareNativeGlobalMeshTargetSet([input], { signal });
      const packet = structuredClone({
        input,
        data: nativeGlobalMeshTargetData(input),
      });
      installNativeGlobalMeshTarget(packet.input, packet.data);
      input = packet.input;
    }
    const set = prepareNativeGlobalMeshTargetSet([input], { signal }),
      target = set.targets[0];
    const preparedMs = performance.now() - started;
    expect(hash(target.evaluator.surface.normals)).toBe(c.facetNormalsSha256);
    expect(hash(target.neighbours)).toBe(c.neighborMasksSha256);
    const root = target.evaluator.root;
    expect(root).toBeDefined();
    const digest = createHash("sha256"),
      pending = [root!];
    let nodes = 0,
      memberships = 0;
    while (pending.length) {
      const node = pending.pop()!,
        children = Array.from({ length: 8 }, (_, i) => node.children[i]);
      const doubles = Float64Array.from([
        ...(node.bounds as number[]),
        ...(node.center as number[]),
        ...node.inverse,
      ]);
      const header = Uint32Array.of(
        node.depth,
        Number(node.flat),
        children.reduce((mask, ch, i) => mask | (ch ? 1 << i : 0), 0),
        node.triangles.length,
      );
      digest.update(Buffer.from(doubles.buffer));
      digest.update(Buffer.from(header.buffer));
      digest.update(
        Buffer.from(
          node.triangles.buffer,
          node.triangles.byteOffset,
          node.triangles.byteLength,
        ),
      );
      nodes++;
      memberships += node.triangles.length;
      for (let i = 7; i >= 0; i--) if (children[i]) pending.push(children[i]!);
    }
    expect(nodes).toBe(c.nodes);
    expect(memberships).toBe(c.memberships);
    expect(digest.digest("hex")).toBe(c.indexSha256);
    const scratch = {
        stack: [],
        projection: new Float64Array(3),
        edgeFlags: new Uint8Array(1),
      },
      distance = new Float64Array(1),
      projection = new Float64Array(3),
      edge = new Uint8Array(1);
    for (let repeat = 0; repeat < 2; repeat++)
      for (const q of c.queries) {
        distance[0] = q.radius;
        projection.set([11, 12, 13]);
        edge[0] = 255;
        const winner = target.evaluator.query(
          q.point,
          distance,
          projection,
          edge,
          scratch,
        );
        expect(winner ?? null).toBe(q.winner);
        expect(bits(distance)).toBe(q.distanceBits);
        expect(bits(projection)).toBe(q.projectionBits);
        expect(edge[0]).toBe(q.edgeFlags);
        const result = set.query(q.point, q.radius);
        expect(
          bits(result?.point ?? [Math.fround(3.4028234663852886e38), 0, 0]),
        ).toBe(q.outputBits);
        expect(bits(result?.normal ?? [91, 92, 93])).toBe(q.normalBits);
      }
    expect(prepareNativeGlobalMeshTargetSet([input]).targets[0]).toBe(target);
    const reportPath = process.env.SCANFORGE_NATIVE_OWNER_MESH_REPORT;
    if (reportPath)
      writeFileSync(
        reportPath,
        JSON.stringify(
          {
            faces: c.triangles,
            nodes,
            memberships,
            preparedMs,
            phaseHeapPeakMiB: maxHeap / 1048576,
            phaseArrayBuffersPeakMiB: maxArrays / 1048576,
            queries: c.queries.length * 2,
            indexHashMatched: true,
            normalsHashMatched: true,
            boundaryMaskHashMatched: true,
            reused: true,
            sharedPreparedRestore: shared,
            originalSourceIdentityRechecked: false,
          },
          null,
          2,
        ),
      );
  },
  120000,
);
