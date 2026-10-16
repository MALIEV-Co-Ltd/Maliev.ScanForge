import { expect, it, vi } from "vitest";
import { createOperations } from "../src/automation/operations";
import { importScan } from "../src/import-client";
import { readScan } from "../src/import-parser";
import { serializeProject, parseProject } from "../src/io";
import type { WorkspaceHost, CommandContext } from "../src/automation/api";
import type { Entity, Project } from "../src/types";
vi.mock("../src/import-client", () => ({ importScan: vi.fn() }));

it("preserves PLY normals through MCP import, geometry readback and project recovery", async () => {
  const source = `ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0 0 0 1\n1 0 0 0 1 0\n0 1 0 1 0 0\n3 2 0 1\n`;
  vi.mocked(importScan).mockImplementationOnce((file, options) =>
    readScan(file, "ply", options),
  );
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
    artifactBlob: () => new File([source], "scan.ply"),
    artifact: (value: string) => JSON.parse(value),
  } as unknown as CommandContext;
  const operations = createOperations(host);
  await operations.project_import({ artifactId: "scan" }, context);
  const expected = [1, 0, 0, 0, 0, 1, 0, 1, 0];
  expect(entities[0].normals).toEqual(new Float32Array(expected));
  const readback = await operations.object_get(
    { entityId: entities[0].id, includeGeometry: true },
    context,
  );
  expect(readback).toMatchObject({ geometry: { normals: expected } });
  const project: Project = {
    format: "maliev-scanforge",
    version: 1,
    name: "Normals",
    units: "mm",
    entities,
  };
  expect(
    parseProject(serializeProject(project.name, project.entities)).entities[0]
      .normals,
  ).toEqual(expected);
});
