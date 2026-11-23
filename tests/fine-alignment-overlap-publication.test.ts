import { afterEach, expect, it, vi } from "vitest";
import type { ProcessingResult } from "../src/processing-client";
import { createOperations } from "../src/automation/operations";
import { processScanRegistration } from "../src/scan-registration";
import type {
  CommandContext,
  WorkspaceHost,
  WorkspaceSnapshot,
} from "../src/automation/api";
import type { Entity } from "../src/types";

vi.mock("../src/scan-registration", () => ({
  processScanRegistration: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

it("does not publish fitted geometry when the final distance-gated overlap remains insufficient", async () => {
  const positions = new Float32Array([
    0, 0, 0.1, 1, 0, 0.1, 0, 1, 0.1, 0, 0, 100, 1, 0, 100, 0, 1, 100,
  ]);
  const before = positions.slice();
  const messages: { result?: ProcessingResult; error?: string }[] = [];
  const scope = {
    onmessage: null as unknown as (event: { data: unknown }) => Promise<void>,
    postMessage: (value: (typeof messages)[number]) => messages.push(value),
  };
  vi.stubGlobal("self", scope);
  await import("../src/processing-worker");
  await scope.onmessage({
    data: {
      kind: "icp",
      positions,
      sourceIndexed: {
        vertices: positions,
        triangles: new Uint32Array([0, 1, 2, 3, 4, 5]),
      },
      target: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      maxDistance: 2,
      overlapPercent: 100,
      targetRms: 0.01,
      sampleSize: 6,
    },
  });
  const output = messages.at(-1)!;
  expect(output.error).toBeUndefined();
  expect(output.result?.registration).toMatchObject({
    overlapPoints: 3,
    requiredOverlapPoints: 6,
    overlapSatisfied: false,
    applied: false,
    converged: false,
    terminationReason: "insufficientOverlap",
  });
  expect(output.result?.registration?.transform.translation[2]).toBeCloseTo(
    -0.1,
  );
  expect(output.result?.positions).toBeUndefined();
  expect(output.result?.indexedMesh).toBeUndefined();
  expect(output.result?.renderData).toBeUndefined();
  expect(positions).toEqual(before);

  const moving: Entity = {
    id: "moving",
    name: "moving",
    kind: "pointcloud",
    positions,
    color: "#fff",
    opacity: 1,
    visible: true,
  };
  const state = {
    entities: [
      moving,
      { ...moving, id: "fixed", positions: positions.slice(0, 9) },
    ],
    selectedId: moving.id,
    history: [],
    future: [],
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
  // The actual worker result crosses the browser worker boundary here.
  vi.mocked(processScanRegistration).mockResolvedValueOnce(output.result!);
  const result = await createOperations(host).mesh_process(
    { entityId: moving.id, targetId: "fixed", operation: { kind: "icp" } },
    context,
  );
  expect(result).toMatchObject({
    entityIds: [],
    registration: { applied: false, terminationReason: "insufficientOverlap" },
  });
  expect(host.commit).not.toHaveBeenCalled();
  expect(state.entities[0]).toBe(moving);
  expect(state.history).toEqual([]);
});
