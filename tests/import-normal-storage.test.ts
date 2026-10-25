import { expect, it, vi } from "vitest";
import { createOperations } from "../src/automation/operations";
import { importScan } from "../src/import-client";
import type { CommandContext, WorkspaceHost } from "../src/automation/api";
import type { Entity } from "../src/types";
import {
  decodeProjectContents,
  encodeProjectFileLocally,
} from "../src/project-file-codec";

vi.mock("../src/import-client", () => ({ importScan: vi.fn() }));

it.each([
  ["ply", false],
  ["asc", false],
  ["ply", true],
] as const)(
  "retains the transferred %s scanner normal buffer without numeric-array expansion (shared=%s)",
  async (extension, shared) => {
    const values = (input: number[]) => {
      const result = shared
        ? new Float32Array(new SharedArrayBuffer(input.length * 4))
        : new Float32Array(input.length);
      result.set(input);
      return result;
    };
    const positions = values([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normals = values([-0, 0.25, 1, 0, 0, 1, 0, 0, 1]);
    const before = normals.slice();
    vi.mocked(importScan).mockImplementationOnce(async (_file, options) => {
      if (extension === "asc") options?.onPointCloud?.({ normals });
      else options?.onMeshNormals?.(normals);
      return positions;
    });
    let entities: Entity[] = [];
    const host = {
      snapshot: () => ({ entities, history: [], future: [] }),
      commit: (next: Entity[]) => {
        entities = next;
      },
      select: vi.fn(),
      view: vi.fn(),
    } as unknown as WorkspaceHost;
    const context = {
      signal: new AbortController().signal,
      check: vi.fn(),
      progress: vi.fn(),
      artifactBlob: () => new File(["fixture"], `scan.${extension}`),
    } as unknown as CommandContext;
    await createOperations(host).project_import(
      { artifactId: "fixture", unit: "mm" },
      context,
    );
    expect(entities).toHaveLength(1);
    expect(entities[0].normals).toBe(normals);
    expect(entities[0].normals).toBeInstanceOf(Float32Array);
    expect(entities[0].positions).toBe(positions);
    expect(new Uint8Array(normals.buffer)).toEqual(
      new Uint8Array(before.buffer),
    );
    const snapshot = {
      project: {
        format: "maliev-scanforge" as const,
        version: 1 as const,
        units: "mm" as const,
        name: "Scanner",
        entities,
      },
      history: [{ label: "Import", entities }],
      future: [],
    };
    const cloned = structuredClone(snapshot);
    expect(cloned.history[0].entities[0].normals).toBe(
      cloned.project.entities[0].normals,
    );
    expect(
      (cloned.project.entities[0].normals as Float32Array).buffer instanceof
        SharedArrayBuffer,
    ).toBe(shared);
    const ordinary = {
      ...entities[0],
      positions: Float32Array.from(positions),
      normals: Float32Array.from(normals),
    };
    const encoded = await encodeProjectFileLocally(cloned);
    const ordinaryEncoded = await encodeProjectFileLocally({
      ...snapshot,
      project: { ...snapshot.project, entities: [ordinary] },
      history: [{ label: "Import", entities: [ordinary] }],
    });
    expect(new Uint8Array(await encoded.arrayBuffer())).toEqual(
      new Uint8Array(await ordinaryEncoded.arrayBuffer()),
    );
    expect(normals).toEqual(before);
    const restored = await decodeProjectContents(encoded);
    expect(restored.project.entities[0].normals).toBeInstanceOf(Float32Array);
    expect(restored.project.entities[0].normals).toEqual(before);
    expect(Object.is(restored.project.entities[0].normals![0], -0)).toBe(true);
    expect(restored.history[0].entities[0].normals).toBe(
      restored.project.entities[0].normals,
    );
  },
);
