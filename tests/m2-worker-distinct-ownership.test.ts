import { expect, it } from "vitest";
import {
  decodeProjectContents,
  encodeProjectFileLocally,
} from "../src/project-file-codec";
import {
  packProjectTransport,
  unpackProjectTransport,
} from "../src/project-transport";

// The current immutable-geometry convention does not enforce independent storage.
it.fails.each(["array", "float32"])(
  "keeps equal but distinct %s coordinates independent across worker transport",
  async (kind) => {
    const coordinates = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const make = () =>
      kind === "array" ? coordinates.slice() : new Float32Array(coordinates);
    const entity = (id: string) => ({
      id,
      name: id,
      kind: "mesh" as const,
      positions: make(),
      color: "#ffffff",
      visible: true,
      opacity: 1,
    });
    const entities = [entity("a"), entity("b")];
    const file = await encodeProjectFileLocally({
      project: {
        format: "maliev-scanforge",
        version: 1,
        units: "mm",
        name: "ownership",
        entities,
      },
      history: [{ label: "Import", entities }],
      future: [],
    });
    const decoded = await decodeProjectContents(file, {
      sharedReadonlyBuffers: true,
      privateFloat64Chunks: true,
      workerFloat64Views: true,
    });
    const { packet, transfers } = await packProjectTransport(decoded, {
      ownedTypedArrays: true,
      cooperative: false,
    });
    const restored = await unpackProjectTransport<typeof decoded>(
      structuredClone(packet, { transfer: transfers }),
      { releaseOwnedNumericBuffers: true },
    );
    const [a, b] = restored.project.entities;
    expect(restored.history[0].entities[0].positions).toBe(a.positions);
    a.positions[0] = 42;
    expect(b.positions[0]).toBe(0);
  },
);
