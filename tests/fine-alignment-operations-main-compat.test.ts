import { expect, it, vi } from "vitest";
import { createOperations } from "../src/automation/operations";
import { processScanRegistration } from "../src/scan-registration";
import { registerFineAlignment } from "../src/fine-registration";
import { applyRigidTransform } from "../src/registration";
import type {
  WorkspaceHost,
  WorkspaceSnapshot,
  CommandContext,
} from "../src/automation/api";
import type { Entity } from "../src/types";

vi.mock("../src/scan-registration", () => ({
  processScanRegistration: vi.fn(),
}));

it("MCP excludes hidden mesh triangles from fitting and final RMS like the GUI", async () => {
  const moving: Entity = {
    id: "moving",
    name: "moving",
    kind: "mesh",
    visible: true,
    color: "#fff",
    opacity: 1,
    positions: [
      0, 0, 0, 1, 0, 0, 0, 1, 0, 100, 100, 100, 101, 100, 100, 100, 101, 100,
    ],
    meshSelection: { hidden: [1], saved: [] },
  };
  const state = {
    entities: [
      moving,
      {
        ...moving,
        id: "fixed",
        positions: moving.positions.slice(0, 9),
        meshSelection: undefined,
      },
    ],
    selectedId: "moving",
    selection: null,
    history: [],
    future: [],
    authoring: {},
  } as unknown as WorkspaceSnapshot;
  const host = {
    snapshot: () => state,
    commit: vi.fn(),
  } as unknown as WorkspaceHost;
  const context = {
    signal: new AbortController().signal,
    check: vi.fn(),
    progress: vi.fn(),
  } as unknown as CommandContext;
  vi.mocked(processScanRegistration).mockImplementation(
    async (_source, request) => {
      if (request.kind !== "icp") throw Error("Expected fine alignment");
      expect(Array.from(request.sourceTriangleMask!)).toEqual([1, 0]);
      const registration = registerFineAlignment(
        request.positions,
        request.target,
        request,
      );
      return {
        kind: "icp",
        registration,
        positions: applyRigidTransform(
          request.positions,
          registration.transform,
        ),
        diagnostics: {
          rms: registration.rms,
          targetReached: registration.targetReached,
        },
      };
    },
  );
  const result = await createOperations(host).mesh_process(
    {
      entityId: "moving",
      targetId: "fixed",
      operation: {
        kind: "icp",
        targetRms: 0.02,
        maxDistance: 2,
        maxIterations: 200,
        sampleSize: 20000,
        targetSampleSize: 3,
        tolerance: 1e-5,
        trimFraction: 1,
      },
    },
    context,
  );
  expect(
    (result as { registration: ReturnType<typeof registerFineAlignment> })
      .registration,
  ).toMatchObject({
    evaluatedPoints: 3,
    rms: 0,
    targetReached: true,
  });
  expect(host.commit).toHaveBeenCalledOnce();
  moving.locked = true;
  await expect(
    createOperations(host).mesh_process(
      { entityId: "moving", operation: { kind: "icp" } },
      context,
    ),
  ).rejects.toThrow(/locked/);
});

it("binds visible fixed mesh surfaces and source normals internally for MCP fine alignment", async () => {
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const moving: Entity = {
    id: "moving",
    name: "moving",
    kind: "mesh",
    visible: true,
    color: "#fff",
    opacity: 1,
    positions,
  };
  const fixed: Entity = {
    ...moving,
    id: "fixed",
    positions: [
      ...positions,
      ...positions.map((x, i) => (i % 3 === 2 ? x + 10 : x)),
    ],
    meshSelection: { hidden: [1], saved: [] },
  };
  const state = {
    entities: [moving, fixed],
    selectedId: moving.id,
    selection: null,
    history: [],
    future: [],
    authoring: {},
  } as unknown as WorkspaceSnapshot;
  const host = {
    snapshot: () => state,
    commit: vi.fn(),
  } as unknown as WorkspaceHost;
  const context = {
    signal: new AbortController().signal,
    check: vi.fn(),
    progress: vi.fn(),
  } as unknown as CommandContext;
  vi.mocked(processScanRegistration).mockResolvedValueOnce({
    kind: "icp",
    diagnostics: { applied: false },
  });
  await createOperations(host).mesh_process(
    { entityId: moving.id, targetId: fixed.id, operation: { kind: "icp" } },
    context,
  );
  expect(
    vi.mocked(processScanRegistration).mock.calls.at(-1)![1],
  ).toMatchObject({
    sourceNormals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    targetSurface: {
      vertices: fixed.positions,
      triangles: new Uint32Array([0, 1, 2]),
    },
  });
  expect(host.commit).not.toHaveBeenCalled();
  for (const field of ["sourceNormals", "targetNormals", "targetSurface"]) {
    await expect(
      createOperations(host).mesh_process(
        {
          entityId: moving.id,
          targetId: fixed.id,
          operation: { kind: "icp", [field]: [] },
        },
        context,
      ),
    ).rejects.toThrow(/workspace objects/);
  }
});
