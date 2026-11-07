import { expect, it } from "vitest";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
} from "../src/project-file-codec";

it.fails.each(["array", "float32"])(
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
    const restored = await decodeProjectContents(
      await encodeProjectFileLocally(input),
    );
    const [x, y] = restored.project.entities;
    expect(restored.history[0].entities[0].positions).toBe(x.positions);
    x.positions[0] = 42;
    expect(y.positions[0]).toBe(0);
  },
);
