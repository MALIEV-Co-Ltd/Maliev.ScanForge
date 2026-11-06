import { expect, it, vi } from "vitest";
import { runPointCloudMeshCommand } from "../src/ui/point-cloud-mesh-command";

it("submits 3D reconstruction through the same revisioned job contract", async () => {
  const invoke = vi.fn(
    async (command: string, _args: Record<string, unknown>) => ({
      ok: true as const,
      revision: 4,
      result:
        command === "job_get"
          ? {
              status: "succeeded",
              progress: 1,
              stage: "done",
              result: { entityIds: ["poisson"] },
            }
          : { jobId: "job" },
    }),
  );
  await runPointCloudMeshCommand(
    { invoke, currentRevision: () => 4 },
    "cloud",
    {
      kind: "pointCloudPoisson",
      normalMode: "estimate-provided",
      depth: 9,
      densityThreshold: 5,
    },
  );
  expect(invoke.mock.calls[0]).toEqual([
    "mesh_process",
    {
      entityId: "cloud",
      operation: {
        kind: "pointCloudPoisson",
        normalMode: "estimate-provided",
        depth: 9,
        densityThreshold: 5,
      },
      expectedRevision: 4,
      requestId: expect.any(String),
    },
  ]);
});

it("submits the GUI meshing request through the same revisioned public command", async () => {
  const invoke = vi.fn(
    async (command: string, _args: Record<string, unknown>) => ({
      ok: true as const,
      revision: 4,
      result:
        command === "job_get"
          ? {
              status: "succeeded",
              progress: 1,
              stage: "done",
              result: { entityIds: ["mesh"] },
            }
          : { jobId: "job" },
    }),
  );
  const result = await runPointCloudMeshCommand(
    { invoke, currentRevision: () => 4 },
    "cloud",
    { plane: "xz", maxEdgeLength: 2 },
  );
  expect(invoke.mock.calls[0]).toEqual([
    "mesh_process",
    {
      entityId: "cloud",
      operation: { kind: "pointCloudMesh", plane: "xz", maxEdgeLength: 2 },
      expectedRevision: 4,
      requestId: expect.any(String),
    },
  ]);
  expect(result).toEqual({ entityIds: ["mesh"] });
});
