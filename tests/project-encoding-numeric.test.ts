import { expect, it } from "vitest";
import { projectEncodingSnapshot } from "../src/project-encoding-snapshot";
import { unpackProjectEncodingTransport } from "../src/project-encoding-numeric";
import { validatePositions } from "../src/io";
import { packProjectTransport } from "../src/project-transport";
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
