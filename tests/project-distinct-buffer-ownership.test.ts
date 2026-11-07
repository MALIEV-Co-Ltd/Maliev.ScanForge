import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
} from "../src/project-file-codec";

function inputWithPositions(first: number[], second: number[]) {
  const entity = (id: string, positions: number[]) => ({
    id,
    name: id,
    kind: "mesh" as const,
    positions,
    color: "#ffffff",
    visible: true,
    opacity: 1,
  });
  const entities = [entity("a", first), entity("b", second)];
  return {
    project: {
      format: "maliev-scanforge" as const,
      version: 1 as const,
      units: "mm" as const,
      name: "test",
      entities,
    },
    history: [{ label: "Import", entities }],
    future: [],
  };
}

it.each(["array", "float32"])(
  "restores distinct equal %s geometry without sharing mutable storage",
  async (kind) => {
    const original = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const first =
      kind === "array" ? original.slice() : new Float32Array(original);
    const second =
      kind === "array" ? original.slice() : new Float32Array(original);
    const entity = (id: string, positions: number[] | Float32Array) => ({
      id,
      name: id,
      kind: "mesh" as const,
      positions,
      color: "#ffffff",
      visible: true,
      opacity: 1,
    });
    const a = entity("a", first),
      b = entity("b", second);
    const input = {
      project: {
        format: "maliev-scanforge" as const,
        version: 1 as const,
        units: "mm" as const,
        name: "test",
        entities: [a, b],
      },
      history: [{ label: "Import", entities: [a, b] }],
      future: [],
    };
    const file = await encodeProjectFileLocally(input);
    const header = new DataView(await file.slice(0, 16).arrayBuffer());
    const manifestLength = header.getUint32(8, true);
    const manifest = JSON.parse(
      await file.slice(16, 16 + manifestLength).text(),
    );
    expect(manifest.version).toBe(2);
    const [firstRef, secondRef] = manifest.current.map(
      (i: number) => manifest.records[i].positions,
    );
    expect(firstRef.chunk).not.toBe(secondRef.chunk);
    expect(manifest.chunks[firstRef.chunk].sha256).toBe(
      manifest.chunks[secondRef.chunk].sha256,
    );
    const restored = await decodeProjectContents(file);
    const [x, y] = restored.project.entities;
    expect(restored.history[0].entities[0].positions).toBe(x.positions);
    x.positions[0] = 42;
    expect(y.positions[0]).toBe(0);
  },
);

it("keeps the legacy version and intended aliases when equal references are the same array", async () => {
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const file = await encodeProjectFileLocally(
    inputWithPositions(positions, positions),
  );
  const header = new DataView(await file.slice(0, 16).arrayBuffer());
  const manifest = JSON.parse(
    await file.slice(16, 16 + header.getUint32(8, true)).text(),
  );
  expect(manifest.version).toBe(2);
  const restored = await decodeProjectContents(file);
  expect(restored.project.entities[0].positions).toBe(
    restored.project.entities[1].positions,
  );
  expect(restored.history[0].entities[0].positions).toBe(
    restored.project.entities[0].positions,
  );
});

it("does not lend one cached shared buffer to two distinct chunks", async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const input = inputWithPositions(
    Array.from(positions),
    Array.from(positions),
  );
  input.project.entities[0].positions = positions as unknown as number[];
  input.project.entities[1].positions =
    positions.slice() as unknown as number[];
  const file = await encodeProjectFileLocally(input);
  const buffer = new SharedArrayBuffer(positions.byteLength);
  new Float32Array(buffer).set(positions);
  const sha256 = createHash("sha256")
    .update(new Uint8Array(buffer))
    .digest("hex");
  vi.stubGlobal("crossOriginIsolated", true);
  try {
    const restored = await decodeProjectContents(file, {
      sharedReadonlyBuffers: true,
      reusableChunks: [{ sha256, buffer }],
    });
    const [first, second] = restored.project.entities;
    first.positions[0] = 42;
    expect(second.positions[0]).toBe(0);
    expect(restored.history[0].entities[0].positions).toBe(first.positions);
  } finally {
    vi.unstubAllGlobals();
  }
});
