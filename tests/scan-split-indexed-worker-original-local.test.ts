/// <reference types="node" />
import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parsePlyTopology, expandPlyTopology } from "../src/ply-topology";
import { indexedMeshMatches } from "../src/indexed-mesh";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";

it.skipIf(!process.env.SCANFORGE_M2_ORIGINAL_PLY)(
  "runs indexed original-scan Split in the worker dispatcher",
  async () => {
    const bytes = readFileSync(process.env.SCANFORGE_M2_ORIGINAL_PLY!);
    const source = parsePlyTopology(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const positions = expandPlyTopology(source);
    const digest = (a: Float32Array | Uint32Array) =>
      createHash("sha256")
        .update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
        .digest("hex");
    const before = [
      digest(positions),
      digest(source.vertices),
      digest(source.triangles),
    ];
    const bounds = [
      Infinity,
      Infinity,
      Infinity,
      -Infinity,
      -Infinity,
      -Infinity,
    ];
    for (let i = 0; i < source.vertices.length; i += 3)
      for (let axis = 0; axis < 3; axis++) {
        bounds[axis] = Math.min(bounds[axis], source.vertices[i + axis]);
        bounds[axis + 3] = Math.max(
          bounds[axis + 3],
          source.vertices[i + axis],
        );
      }
    const x = (bounds[0] + bounds[3]) / 2,
      margin = Math.max(bounds[4] - bounds[1], bounds[5] - bounds[2], 1);
    const target = new Float32Array([
      x,
      bounds[1] - margin,
      bounds[2] - margin,
      x,
      bounds[1] - margin,
      bounds[5] + 3 * margin,
      x,
      bounds[4] + 3 * margin,
      bounds[2] - margin,
    ]);
    const digest64 = (values: ArrayLike<number>) => {
      const hash = createHash("sha256"),
        chunk = Buffer.allocUnsafe(8 * 4096);
      for (let start = 0; start < values.length; start += 4096) {
        const count = Math.min(4096, values.length - start);
        for (let i = 0; i < count; i++)
          chunk.writeDoubleLE(values[start + i], i * 8);
        hash.update(chunk.subarray(0, count * 8));
      }
      return hash.digest("hex");
    };
    let terminal: ProcessingResponse | undefined;
    const scope = {
      onmessage: null as
        null | ((event: { data: ProcessingRequest }) => Promise<void>),
      postMessage(message: ProcessingResponse, transfers: Transferable[] = []) {
        if ("result" in message || "error" in message) {
          if ("result" in message && message.packedScanEdit) {
            const expectedPositions = digest64(
              message.packedScanEdit.positions,
            );
            const expectedVertices = digest64(message.packedScanEdit.vertices);
            expect(transfers).toContain(
              message.packedScanEdit.positions.buffer,
            );
            expect(transfers).toContain(message.packedScanEdit.vertices.buffer);
            const cloned = structuredClone(message, { transfer: transfers });
            if (!("result" in cloned) || !cloned.packedScanEdit)
              throw Error("Missing packed result");
            cloned.result.scanEdit!.positions = Array.from(
              cloned.packedScanEdit.positions,
            );
            cloned.result.indexedMesh!.vertices = Array.from(
              cloned.packedScanEdit.vertices,
            );
            expect(digest64(cloned.result.scanEdit!.positions!)).toBe(
              expectedPositions,
            );
            expect(digest64(cloned.result.indexedMesh!.vertices)).toBe(
              expectedVertices,
            );
            delete cloned.packedScanEdit;
            terminal = cloned;
          } else if (
            "result" in message &&
            process.env.SCANFORGE_M2_PACKED_PROBE === "1"
          ) {
            const edit = message.result.scanEdit!;
            const indexed = message.result.indexedMesh!;
            const expectedPositions = digest64(edit.positions!);
            const expectedVertices = digest64(indexed.vertices);
            const positions = Float64Array.from(edit.positions!);
            const vertices = Float64Array.from(indexed.vertices);
            edit.positions = positions as unknown as number[];
            indexed.vertices = vertices as unknown as number[];
            transfers.push(positions.buffer, vertices.buffer);
            const cloned = structuredClone(message, { transfer: transfers });
            if (!("result" in cloned)) throw Error("Missing packed result");
            cloned.result.scanEdit!.positions = Array.from(
              cloned.result.scanEdit!.positions!,
            );
            cloned.result.indexedMesh!.vertices = Array.from(
              cloned.result.indexedMesh!.vertices,
            );
            expect(digest64(cloned.result.scanEdit!.positions!)).toBe(
              expectedPositions,
            );
            expect(digest64(cloned.result.indexedMesh!.vertices)).toBe(
              expectedVertices,
            );
            terminal = cloned;
          } else terminal = structuredClone(message, { transfer: transfers });
        }
      },
    };
    vi.stubGlobal("self", scope);
    try {
      await import("../src/processing-worker");
      const request: ProcessingRequest & { geometryKey?: number } = {
        kind: "scanEdit",
        action: "split",
        ...(process.env.SCANFORGE_M2_PERSISTENT_WORKER === "1"
          ? { geometryKey: 1 }
          : {}),
        positions: positions.slice(),
        target,
        sourceIndexed: {
          vertices: source.vertices.slice(),
          triangles: source.triangles.slice(),
        },
      };
      await scope.onmessage!({ data: request });
      if (!terminal || !("result" in terminal))
        throw Error(JSON.stringify(terminal));
      expect(terminal.result.scanEdit?.segments).toBeUndefined();
      const output = terminal.result.scanEdit?.positions;
      expect(output).toBeDefined();
      expect(indexedMeshMatches(terminal.result.indexedMesh, output!)).toBe(
        true,
      );
      expect(terminal.result.scanEdit!.diagnostics.cutEdges).toBeGreaterThan(0);
      expect(terminal.result.scanEdit!.diagnostics.parts).toBeGreaterThan(1);
      const area = (p: ArrayLike<number>) => {
        let sum = 0;
        for (let i = 0; i < p.length; i += 9) {
          const ax = p[i + 3] - p[i],
            ay = p[i + 4] - p[i + 1],
            az = p[i + 5] - p[i + 2];
          const bx = p[i + 6] - p[i],
            by = p[i + 7] - p[i + 1],
            bz = p[i + 8] - p[i + 2];
          sum +=
            Math.hypot(
              ay * bz - az * by,
              az * bx - ax * bz,
              ax * by - ay * bx,
            ) / 2;
        }
        return sum;
      };
      const inputArea = area(positions),
        outputArea = area(output!);
      expect(Math.abs(outputArea - inputArea) / inputArea).toBeLessThan(1e-6);
      console.log(
        JSON.stringify({
          inputFaces: positions.length / 9,
          outputFaces: output!.length / 9,
          inputArea,
          outputArea,
          persistentWorker: process.env.SCANFORGE_M2_PERSISTENT_WORKER === "1",
          packedProbe: process.env.SCANFORGE_M2_PACKED_PROBE === "1",
          diagnostics: terminal.result.scanEdit!.diagnostics,
        }),
      );
      expect([
        digest(positions),
        digest(source.vertices),
        digest(source.triangles),
      ]).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  },
  240_000,
);
