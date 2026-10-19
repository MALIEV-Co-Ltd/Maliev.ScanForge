import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareGlobalAlignmentInput } from "../src/global-alignment-input";
import { executeGlobalAlignmentInputPreparation } from "../src/global-alignment-input-worker";
import type { Entity } from "../src/types";

beforeEach(() => {
  vi.stubGlobal(
    "Worker",
    class {
      onmessage?: (event: { data: unknown }) => void;
      onerror?: unknown;
      onmessageerror?: unknown;
      terminate = vi.fn();
      postMessage(
        packet: Parameters<typeof executeGlobalAlignmentInputPreparation>[0],
        transfer: ArrayBuffer[],
      ) {
        const copy = structuredClone(packet, { transfer });
        queueMicrotask(() => {
          try {
            this.onmessage?.({
              data: { result: executeGlobalAlignmentInputPreparation(copy) },
            });
          } catch (error) {
            this.onmessage?.({ data: { error: (error as Error).message } });
          }
        });
      }
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mesh(id: string): Entity {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  return {
    id,
    name: id,
    kind: "mesh",
    visible: true,
    color: "#aaa",
    opacity: 1,
    positions: vertices,
    indexedMesh: {
      vertices,
      triangles: new Uint32Array([0, 1, 2]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    },
  };
}

it("retires command-owned scan descriptors through their borrowed alias without detaching authored or derived buffers", async () => {
  const entities = [mesh("a"), mesh("b")];
  const authored = entities.map((entity) => ({
    positions: entity.positions,
    vertices: entity.indexedMesh!.vertices,
    triangles: entity.indexedMesh!.triangles,
    normals: entity.indexedMesh!.normals,
    bytes: [
      Array.from(entity.positions),
      Array.from(entity.indexedMesh!.vertices),
      Array.from(entity.indexedMesh!.triangles),
      Array.from(entity.indexedMesh!.normals!),
    ],
  }));
  const prepared = await prepareGlobalAlignmentInput(entities);
  const scansAlias = prepared.input.scans;
  expect(scansAlias).toHaveLength(2);
  const derived = scansAlias.map((scan) => ({
    carrier: scan.geometry.normals,
    bytes: Array.from(scan.geometry.normals),
  }));
  for (let index = 0; index < derived.length; index++) {
    expect(derived[index].carrier).not.toBe(authored[index].normals);
  }
  const summary = structuredClone(prepared.summary);
  // Baseline is expected to fail here: release is declared optional but absent.
  expect(prepared.release).toBeTypeOf("function");
  prepared.release!();
  expect(prepared.input.scans).toHaveLength(0);
  expect(scansAlias).toHaveLength(0);
  prepared.release!();
  expect(prepared.summary).toEqual(summary);
  expect(prepared.entities).toEqual(entities);
  for (let index = 0; index < entities.length; index++) {
    const entity = entities[index],
      original = authored[index];
    expect(entity.positions).toBe(original.positions);
    expect(entity.indexedMesh!.vertices).toBe(original.vertices);
    expect(entity.indexedMesh!.triangles).toBe(original.triangles);
    expect(entity.indexedMesh!.normals).toBe(original.normals);
    expect([
      Array.from(entity.positions),
      Array.from(entity.indexedMesh!.vertices),
      Array.from(entity.indexedMesh!.triangles),
      Array.from(entity.indexedMesh!.normals!),
    ]).toEqual(original.bytes);
    expect(Array.from(derived[index].carrier)).toEqual(derived[index].bytes);
    expect(derived[index].carrier.buffer.byteLength).toBeGreaterThan(0);
  }
});
