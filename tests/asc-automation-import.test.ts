import { expect, it, vi } from "vitest";
import { createOperations } from "../src/automation/operations";
import { importScan } from "../src/import-client";
import { processMesh } from "../src/processing-client";
import type { WorkspaceHost, CommandContext } from "../src/automation/api";
import type { Entity } from "../src/types";
vi.mock("../src/import-client", () => ({ importScan: vi.fn() }));
vi.mock("../src/processing-client", () => ({ processMesh: vi.fn() }));
it("imports point clouds through the automation boundary with normals and point counts", async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0]),
    normals = new Float32Array([0, 0, 1, 0, 0, 1]);
  vi.mocked(importScan).mockImplementationOnce(async (_file, options) => {
    options?.onPointCloud?.({ normals });
    return positions;
  });
  let entities: Entity[] = [];
  const host = {
    snapshot: () => ({ entities, history: [], future: [], authoring: {} }),
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
    artifactBlob: () => new File(["points"], "scan.asc"),
  } as unknown as CommandContext;
  const result = await createOperations(host).project_import(
    { artifactId: "points" },
    context,
  );
  expect(result).toEqual({ entityId: entities[0].id, points: 2 });
  expect(entities[0]).toMatchObject({
    kind: "pointcloud",
    positions,
    normals: Array.from(normals),
  });
  await expect(
    createOperations(host).mesh_analyze({ entityId: entities[0].id }, context),
  ).rejects.toThrow("do not have triangle topology");
  await expect(
    createOperations(host).mesh_process(
      { entityId: entities[0].id, operation: { kind: "report" } },
      context,
    ),
  ).rejects.toThrow("requires triangle mesh");
  const fixed = { ...entities[0], id: "fixed" };
  entities.push(fixed);
  vi.mocked(processMesh).mockResolvedValueOnce({
    kind: "icp",
    positions: new Float32Array([0, 0, 0, 0, 1, 0]),
    diagnostics: {},
    registration: {
      transform: {
        rotation: [1, 0, 0, 0, 0, -1, 0, 1, 0],
        translation: [0, 0, 0],
      },
      rms: 0,
      maxError: 0,
      pairs: 3,
      iterations: 1,
      converged: true,
    },
  });
  await createOperations(host).mesh_process(
    { entityId: entities[0].id, targetId: "fixed", operation: { kind: "icp" } },
    context,
  );
  expect(entities[0].kind).toBe("pointcloud");
  expect(entities[0].normals).toEqual([0, -1, 0, 0, -1, 0]);
  expect(entities[1]).toBe(fixed);
});
