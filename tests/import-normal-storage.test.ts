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

it.each(["ply", "asc"])(
  "retains the transferred %s scanner normal buffer without numeric-array expansion",
  async (extension) => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normals = new Float32Array([-0, 0.25, 1, 0, 0, 1, 0, 0, 1]);
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
    const restored = await decodeProjectContents(
      await encodeProjectFileLocally({
        project: {
          format: "maliev-scanforge",
          version: 1,
          units: "mm",
          name: "Scanner",
          entities,
        },
        history: [{ label: "Import", entities }],
        future: [],
      }),
    );
    expect(restored.project.entities[0].normals).toBeInstanceOf(Float32Array);
    expect(restored.project.entities[0].normals).toEqual(before);
    expect(Object.is(restored.project.entities[0].normals![0], -0)).toBe(true);
    expect(restored.history[0].entities[0].normals).toBe(
      restored.project.entities[0].normals,
    );
  },
);
