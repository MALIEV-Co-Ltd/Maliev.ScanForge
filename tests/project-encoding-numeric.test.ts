import { expect, it } from "vitest";
import { projectEncodingSnapshot } from "../src/project-encoding-snapshot";
import { unpackProjectEncodingTransport } from "../src/project-encoding-numeric";
import { validatePositions } from "../src/io";
import {
  containsLargeNumericArrays,
  packProjectTransport,
} from "../src/project-transport";
import { markPrivateDecodingView } from "../src/project-private-decoding-views";
import {
  decodeProjectContents,
  encodeProjectFileLocally,
  type ProjectSession,
} from "../src/project-file-codec";

it("continues to reject arbitrary Float64 geometry outside the encoder", () => {
  expect(() => validatePositions(new Float64Array(9))).toThrow(
    /Invalid triangle/,
  );
});

it("preserves private restored Float64 geometry through the encoding worker boundary", async () => {
  const values = markPrivateDecodingView(
    Float64Array.from({ length: 65538 }, (_, i) => (i === 0 ? -0 : i / 17)),
  );
  const positions = values as unknown as number[];
  const entity = {
    id: "scan",
    name: "Scan",
    kind: "mesh" as const,
    positions,
    indexedMesh: {
      vertices: positions,
      triangles: Uint32Array.from(
        { length: positions.length / 3 },
        (_, i) => i,
      ),
    },
    color: "#ffffff",
    visible: true,
    opacity: 1,
  };
  const session: ProjectSession = {
    project: {
      format: "maliev-scanforge",
      version: 1,
      units: "mm",
      name: "test",
      entities: [entity],
    },
    history: [{ label: "Import", entities: [entity] }],
    future: [],
  };
  const snapshot = projectEncodingSnapshot(session);
  expect(containsLargeNumericArrays(snapshot)).toBe(true);
  const { packet, transfers } = await packProjectTransport(snapshot);
  expect(transfers).not.toContain(values.buffer);
  const received = structuredClone(packet, { transfer: transfers });
  expect(values.byteLength).toBe(65538 * 8);
  const decoded = await unpackProjectEncodingTransport(received);
  const workerEntity = decoded.session.project.entities[0];
  expect(workerEntity.positions).toBeInstanceOf(Float64Array);
  expect(workerEntity.indexedMesh!.vertices).toBe(workerEntity.positions);
  const reopened = await decodeProjectContents(
    await encodeProjectFileLocally(decoded.session),
  );
  expect(reopened.project.entities[0].positions).toEqual(Array.from(values));
  expect(Object.is(reopened.project.entities[0].positions[0], -0)).toBe(true);
  expect(reopened.history[0].entities[0].positions).toBe(
    reopened.project.entities[0].positions,
  );
});

it("keeps aliases to non-geometry fields as ordinary arrays across encoding", async () => {
  const values = markPrivateDecodingView(
    Float64Array.from({ length: 65538 }, (_, i) => i / 11),
  );
  const positions = values as unknown as number[];
  const snapshot = projectEncodingSnapshot({
    project: {
      format: "maliev-scanforge",
      version: 1,
      units: "mm",
      name: "test",
      entities: [
        {
          id: "scan",
          name: "Scan",
          kind: "mesh",
          positions,
          edgePositions: positions,
          color: "#ffffff",
          visible: true,
          opacity: 1,
        },
      ],
    },
    history: [],
    future: [],
  });
  const { packet, transfers } = await packProjectTransport(snapshot);
  const decoded = await unpackProjectEncodingTransport(
    structuredClone(packet, { transfer: transfers }),
  );
  const entity = decoded.session.project.entities[0];
  expect(Array.isArray(entity.positions)).toBe(true);
  expect(entity.positions).toBe(entity.edgePositions);
  expect(entity.positions).toEqual(Array.from(values));
});

it("does not detach the source when private-buffer packing is cancelled", async () => {
  const values = markPrivateDecodingView(new Float64Array(65538).fill(0.1));
  let checks = 0;
  await expect(
    packProjectTransport(
      { values },
      {
        check: () => {
          if (++checks === 4) throw new DOMException("Cancelled", "AbortError");
        },
      },
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(values.byteLength).toBe(65538 * 8);
  expect(values[0]).toBe(0.1);
});

it("encodes transferred precise indexed mesh arrays without reconstructing them and preserves the saved file", async () => {
  const positions = Array.from({ length: 65538 }, (_, i) =>
    i === 0 ? -0 : i / 17,
  );
  const entity = {
    id: "scan",
    name: "Scan",
    kind: "mesh" as const,
    positions,
    indexedMesh: {
      vertices: positions,
      triangles: Uint32Array.from(
        { length: positions.length / 3 },
        (_, i) => i,
      ),
    },
    color: "#ffffff",
    visible: true,
    opacity: 1,
  };
  const session: ProjectSession = {
    project: {
      format: "maliev-scanforge",
      version: 1,
      units: "mm",
      name: "test",
      entities: [entity],
    },
    history: [{ label: "Import", entities: [entity] }],
    future: [],
  };
  const baseline = await encodeProjectFileLocally(session);
  const { packet } = await packProjectTransport(
    projectEncodingSnapshot(session),
  );
  const decoded = await unpackProjectEncodingTransport(packet);
  const workerEntity = decoded.session.project.entities[0];
  expect(workerEntity.positions).toBeInstanceOf(Float64Array);
  expect(workerEntity.indexedMesh!.vertices).toBe(workerEntity.positions);
  const result = await encodeProjectFileLocally(decoded.session);
  expect(new Uint8Array(await result.arrayBuffer())).toEqual(
    new Uint8Array(await baseline.arrayBuffer()),
  );
  const reopened = await decodeProjectContents(result);
  expect(reopened.project.entities[0].positions).toEqual(positions);
  expect(Object.is(reopened.project.entities[0].positions[0], -0)).toBe(true);
  expect(reopened.history[0].entities[0].positions).toBe(
    reopened.project.entities[0].positions,
  );
});

it("keeps ordinary arrays when an eligible buffer is also used in metadata", async () => {
  const positions = Array.from({ length: 65538 }, (_, i) => i / 11);
  const snapshot = projectEncodingSnapshot({
    project: {
      format: "maliev-scanforge",
      version: 1,
      units: "mm",
      name: "test",
      entities: [
        {
          id: "scan",
          name: "Scan",
          kind: "mesh",
          positions,
          color: "#ffffff",
          visible: true,
          opacity: 1,
          edgePositions: positions,
        },
      ],
    },
    history: [],
    future: [],
  });
  const { packet } = await packProjectTransport(snapshot);
  const result = await unpackProjectEncodingTransport(packet);
  expect(Array.isArray(result.session.project.entities[0].positions)).toBe(
    true,
  );
  expect(result.session.project.entities[0].positions).toBe(
    result.session.project.entities[0].edgePositions,
  );
});
