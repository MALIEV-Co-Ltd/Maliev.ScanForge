import { expect, it, vi } from "vitest";
import { createOperations } from "../src/automation/operations";
import type { WorkspaceHost, CommandContext } from "../src/automation/api";
import type { Entity } from "../src/types";

it.each(["copy", "cut", "delete"])(
  "preserves exact facet-normal slots during mesh selection %s",
  (operation) => {
    const positions = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 3, 0, 0, 4, 0, 0, 3, 1, 0,
    ]);
    const normals = new Float32Array([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
    const source: Entity = {
      id: "mesh",
      name: "scan",
      kind: "mesh",
      positions,
      normals,
      visible: true,
      color: "#fff",
      opacity: 1,
    };
    let entities = [source];
    let selectedId = "mesh";
    let selection: Uint8Array | null = Uint8Array.from([1, 0]);
    const host = {
      snapshot: () => ({
        entities,
        selectedId,
        selection,
      }),
      commit: (next: Entity[]) => {
        if (next.find((e) => e.id === "mesh")?.positions !== source.positions)
          selection = null;
        entities = next;
      },
      setSelection: (id: string, mask: Uint8Array) => {
        selectedId = id;
        selection = mask;
      },
      select: (id: string) => {
        selectedId = id;
      },
    } as unknown as WorkspaceHost;
    const context = {
      check: vi.fn(),
      signal: new AbortController().signal,
    } as unknown as CommandContext;
    createOperations(host).selection_edit(
      { entityId: "mesh", operation },
      context,
    );
    if (operation !== "copy")
      expect(
        Array.from(entities.find((e) => e.id === "mesh")!.normals!),
      ).toEqual([...normals.slice(9)]);
    if (operation !== "delete")
      expect(
        Array.from(entities.find((e) => e.id !== "mesh")!.normals!),
      ).toEqual([...normals.slice(0, 9)]);
    expect(selectedId).toBe(
      operation === "delete"
        ? "mesh"
        : entities.find((e) => e.id !== "mesh")!.id,
    );
    expect(selection?.some(Boolean) ?? false).toBe(false);
    expect([...source.positions]).toEqual([...positions]);
    expect([...source.normals!]).toEqual([...normals]);
  },
);
