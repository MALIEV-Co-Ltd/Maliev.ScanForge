import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createOperations } from "../src/automation/operations";
import { createWorkflowOperations } from "../src/automation/workflow-operations";
import type {
  CommandContext,
  WorkspaceHost,
  WorkspaceSnapshot,
} from "../src/automation/api";
import {
  acceptLandmarkAlignment,
  beginLandmarkAlignment,
  editLandmarks,
  landmarkSceneUnchanged,
  landmarkState,
  prepareLandmarkRequest,
  type LandmarkAlignment,
  type LandmarkPreviewOptions,
} from "../src/landmark-alignment";
import { canonicalCloud } from "../src/point-cloud-placement";
import { processScanRegistration } from "../src/scan-registration";
import type {
  ProcessingResponse,
  ProcessingResult,
} from "../src/processing-client";
import type { Entity, Positions, Vec3 } from "../src/types";

// Real worker entrypoints run in-process. Only message transport and the
// workspace/viewport adapter are replaced; no parser, edit, solver or result is mocked.
type Entry = (event: { data: unknown }) => unknown | Promise<unknown>;
type Route = "import" | "processing";
const entries = new Map<Route, Entry>();
let receiver: InProcessWorker | undefined;
const controllers: AbortController[] = [];

class InProcessWorker {
  static instances: InProcessWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  readonly requests: unknown[] = [];
  readonly replies: unknown[] = [];
  readonly route: Route;
  closed = false;
  terminate = vi.fn(() => {
    this.closed = true;
  });

  constructor(url: URL, options?: WorkerOptions) {
    expect(options?.type).toBe("module");
    const path = url.pathname;
    if (path.endsWith("/import-worker.ts")) this.route = "import";
    else if (path.endsWith("/processing-worker.ts")) this.route = "processing";
    else throw Error(`Unexpected transport worker: ${path}`);
    InProcessWorker.instances.push(this);
  }

  postMessage(message: unknown, transfer: Transferable[] = []) {
    const packet = structuredClone(message, { transfer });
    this.requests.push(packet);
    queueMicrotask(() => {
      if (this.closed) return;
      receiver = this;
      const entry = entries.get(this.route);
      const failure = (error: unknown) => {
        if (!this.closed)
          this.onerror?.({
            message: error instanceof Error ? error.message : String(error),
          });
      };
      const finish = () => {
        if (receiver === this) receiver = undefined;
      };
      try {
        if (!entry) throw Error("Real worker entrypoint was not installed");
        void Promise.resolve(entry({ data: packet }))
          .catch(failure)
          .finally(finish);
      } catch (error) {
        failure(error);
        finish();
      }
    });
  }
}

function scope(route: Route) {
  return {
    onmessage: null as Entry | null,
    postMessage(message: unknown, transfer: Transferable[] = []) {
      const worker = receiver;
      if (!worker || worker.route !== route)
        throw Error("Wrong worker reply owner");
      const packet = structuredClone(message, { transfer });
      worker.replies.push(packet);
      queueMicrotask(() => {
        if (!worker.closed) worker.onmessage?.({ data: packet });
      });
    },
  };
}

beforeAll(async () => {
  try {
    const importer = scope("import");
    vi.stubGlobal("self", importer);
    await import("../src/import-worker");
    if (!importer.onmessage) throw Error("Import entrypoint missing");
    entries.set("import", importer.onmessage);
    const processor = scope("processing");
    vi.stubGlobal("self", processor);
    await import("../src/processing-worker");
    if (!processor.onmessage) throw Error("Processing entrypoint missing");
    entries.set("processing", processor.onmessage);
  } finally {
    vi.unstubAllGlobals();
  }
});

beforeEach(() => {
  InProcessWorker.instances.length = 0;
  receiver = undefined;
  vi.stubGlobal("Worker", InProcessWorker);
});
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.abort();
  for (const worker of InProcessWorker.instances)
    if (!worker.closed) worker.terminate();
  receiver = undefined;
  vi.unstubAllGlobals();
});

const points = [
  0, 0, 0, 0.1, 0, 0, 20, 0, 0, 20.1, 0, 0, 40, 40, 40, 0, 20, 0, 0, 0, 20, 0,
  0, 20.1,
];
const normals = [
  1, 0, 0, 0, 1, 0, 0, 0, 1, -1, 0, 0, 0, -1, 0, 0, 0, -1, 0.6, 0.8, 0, 0, 0.6,
  0.8,
];
const retainedIds = [0, 2, 5, 6];
const retained = (values: ArrayLike<number>, ids: number[]) =>
  ids.flatMap((id) => [values[id * 3], values[id * 3 + 1], values[id * 3 + 2]]);
const point = (values: Positions, id: number) =>
  Array.from(values.slice(id * 3, id * 3 + 3)) as Vec3;
const mappedPoint = ([x, y, z]: readonly number[]) => [10 - y, 20 + x, 30 + z];
const mappedNormal = ([x, y, z]: readonly number[]) => [-y, x, z];
function near(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  tolerance = 1e-4,
) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++)
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(tolerance);
}
function pointResult(algorithm: string): ProcessingResult {
  for (const worker of InProcessWorker.instances)
    for (const message of worker.replies) {
      const reply = message as ProcessingResponse;
      if ("result" in reply && reply.result.diagnostics.algorithm === algorithm)
        return reply.result;
    }
  throw Error(`Missing real processing result ${algorithm}`);
}

type LandmarkEdit = Parameters<NonNullable<WorkspaceHost["editLandmarks"]>>[0];
function workspace(files: Record<string, File>) {
  const state: WorkspaceSnapshot = {
    name: "ASC composition",
    entities: [],
    history: [],
    future: [],
    authoring: {},
    selectedId: null,
    selection: null,
    settings: {},
  };
  let session: LandmarkAlignment | undefined;
  const commit = vi.fn((next: Entity[], label: string) => {
    const previous = state.entities.find(
      (entity) => entity.id === state.selectedId,
    );
    state.history = [...state.history, { entities: state.entities, label }];
    state.entities = next.map(canonicalCloud);
    const current = state.entities.find(
      (entity) => entity.id === state.selectedId,
    );
    if (current?.positions !== previous?.positions) state.selection = null;
  });
  const entity = (id: string) => {
    const result = state.entities.find((value) => value.id === id);
    if (!result) throw Error(`Unknown fixture entity ${id}`);
    return result;
  };
  const host = {
    snapshot: () => state,
    commit,
    select: (id: string) => {
      state.selectedId = id;
      state.selection = null;
    },
    setSelection: (id: string, selection: Uint8Array) => {
      state.selectedId = id;
      state.selection = selection;
    },
    view: vi.fn(),
    present: async () => {},
    cad: () => {
      throw Error("Point-cloud fixture must not acquire CAD");
    },
    editLandmarks: (edit: LandmarkEdit) => {
      if (edit.action === "begin")
        session = beginLandmarkAlignment(
          entity(edit.movingId),
          edit.fixedId ? entity(edit.fixedId) : undefined,
          { scene: state.entities, targetScope: edit.targetScope ?? "fixed" },
        );
      else {
        if (!session) throw Error("No landmark session");
        session = editLandmarks(session, edit, state.entities);
      }
      return landmarkState(session);
    },
    inspectLandmarks: () =>
      session ? landmarkState(session) : { active: false },
    previewLandmarks: async (options: LandmarkPreviewOptions) => {
      if (!session) throw Error("No landmark session");
      const original = session;
      options.signal?.throwIfAborted();
      const request = await prepareLandmarkRequest(
        original,
        async () => {
          throw Error("Point-cloud fixture must not acquire a CAD target");
        },
        options,
      );
      const preview = await processScanRegistration(original.moving, request, {
        signal: options.signal,
        check: options.check,
        onProgress: options.onProgress,
        workerCount: options.workerCount,
        parallel: options.parallel,
      });
      options.check?.();
      if (
        session !== original ||
        !landmarkSceneUnchanged(original, state.entities)
      )
        throw Error("Stale landmark preview");
      session = { ...original, preview };
      return landmarkState(session);
    },
    acceptLandmarks: () => {
      if (!session) throw Error("No landmark session");
      const preview = session.preview;
      commit(
        acceptLandmarkAlignment(session, state.entities),
        "Align by corresponding points",
      );
      session = undefined;
      return {
        active: false,
        accepted: true,
        registration: preview?.registration,
      };
    },
  } as unknown as WorkspaceHost;
  const controller = new AbortController();
  controllers.push(controller);
  const context = {
    signal: controller.signal,
    check: () => controller.signal.throwIfAborted(),
    progress: vi.fn(),
    artifactBlob: (id: string) => {
      if (!files[id]) throw Error(`Unknown fixture artifact ${id}`);
      return files[id];
    },
  } as unknown as CommandContext;
  return {
    state,
    commit,
    context,
    entity,
    session: () => session,
    operations: createOperations(host),
    workflow: createWorkflowOperations(host),
  };
}

it.each(["voxel", "sampleCount"] as const)(
  "preserves six-column ASC record/normal identity through delete, %s, smoothing and real N-points preview/Apply",
  async (reduction) => {
    const asc = readFileSync(
      new URL("./fixtures/asc-edit-alignment-composition.asc", import.meta.url),
      "utf8",
    );
    const fixedAsc = Array.from({ length: 8 }, (_, id) =>
      [
        ...mappedPoint(points.slice(id * 3, id * 3 + 3)),
        ...mappedNormal(normals.slice(id * 3, id * 3 + 3)),
      ].join(" "),
    ).join("\n");
    const h = workspace({
      moving: new File([asc], "moving.asc"),
      fixed: new File([fixedAsc], "fixed.asc"),
    });
    const movingImport = (await h.operations.project_import(
      { artifactId: "moving", unit: "mm" },
      h.context,
    )) as { entityId: string; points: number };
    const fixedImport = (await h.operations.project_import(
      { artifactId: "fixed", unit: "mm" },
      h.context,
    )) as { entityId: string; points: number };
    expect(movingImport.points).toBe(8);
    expect(fixedImport.points).toBe(8);
    const authored = h.entity(movingImport.entityId),
      fixed = h.entity(fixedImport.entityId);
    expect(authored.kind).toBe("pointcloud");
    expect(authored.positions).toEqual(new Float32Array(points));
    expect(authored.normals).toEqual(new Float32Array(normals));
    const authoredSnapshot = structuredClone(authored),
      fixedSnapshot = structuredClone(fixed);
    const authoredPositions = Array.from(authored.positions),
      authoredNormals = Array.from(authored.normals!);
    const fixedPositions = Array.from(fixed.positions),
      fixedNormals = Array.from(fixed.normals!);
    const f32Normals = new Float32Array(normals);
    const movingId = movingImport.entityId;

    h.operations.selection_set(
      { entityId: movingId, points: [1, 4] },
      h.context,
    );
    h.operations.selection_edit(
      { entityId: movingId, operation: "delete" },
      h.context,
    );
    expect(Array.from(h.entity(movingId).positions)).toEqual(
      retained(new Float32Array(points), [0, 2, 3, 5, 6, 7]),
    );
    expect(h.entity(movingId).normals).toEqual(
      retained(f32Normals, [0, 2, 3, 5, 6, 7]),
    );
    expect(h.state.selection).toBeNull();

    await h.operations.mesh_process(
      {
        entityId: movingId,
        operation:
          reduction === "voxel"
            ? { kind: "pointCloudEdit", action: "voxel", cellSize: 0.5 }
            : {
                kind: "pointCloudEdit",
                action: "sampleCount",
                targetPoints: 4,
              },
      },
      h.context,
    );
    const reduced = h.entity(movingId);
    expect(Array.from(reduced.positions)).toEqual(
      retained(new Float32Array(points), retainedIds),
    );
    expect(reduced.normals).toEqual(retained(f32Normals, retainedIds));
    const reductionResult = pointResult(
      `point-cloud-${reduction}`,
    ).pointCloudEdit!;
    expect(Array.from(reductionResult.sourceIndices!)).toEqual([0, 1, 3, 4]);
    expect(
      Array.from(
        reductionResult.sourceIndices!,
        (id) => [0, 2, 3, 5, 6, 7][id],
      ),
    ).toEqual(retainedIds);

    h.operations.selection_set({ entityId: movingId, points: [0] }, h.context);
    const smoothing = (await h.operations.mesh_process(
      {
        entityId: movingId,
        selectionOnly: true,
        operation: {
          kind: "pointCloudEdit",
          action: "smooth",
          neighborRadius: 30,
          iterations: 1,
          strength: 0.5,
          deviation: 0.05,
        },
      },
      h.context,
    )) as { diagnostics: Record<string, unknown> };
    const smoothed = h.entity(movingId);
    expect(smoothing.diagnostics.normalsReestimated).toBe(false);
    expect(smoothed.normals).toEqual(retained(f32Normals, retainedIds));
    expect(Array.from(smoothed.positions.slice(3))).toEqual(
      Array.from(reduced.positions.slice(3)),
    );
    const displacement = Math.hypot(
      ...Array.from(smoothed.positions.slice(0, 3)),
    );
    expect(displacement).toBeGreaterThan(0);
    expect(displacement).toBeLessThanOrEqual(0.05000001);
    const beforeAlignmentPositions = Array.from(smoothed.positions),
      beforeAlignmentNormals = Array.from(smoothed.normals!);

    h.workflow.landmark_edit(
      { action: "begin", movingId, fixedId: fixed.id, targetScope: "fixed" },
      h.context,
    );
    // Smoothing changed slot0 only. Original IDs2/5/6 are now current slots1/2/3.
    for (const [currentId, originalId] of [
      [1, 2],
      [2, 5],
      [3, 6],
    ]) {
      h.workflow.landmark_edit(
        {
          action: "pick",
          entityId: movingId,
          point: point(smoothed.positions, currentId),
        },
        h.context,
      );
      h.workflow.landmark_edit(
        {
          action: "pick",
          entityId: fixed.id,
          point: point(fixed.positions, originalId),
        },
        h.context,
      );
    }
    const entriesBeforePreview = h.state.history.length,
      commitsBeforePreview = h.commit.mock.calls.length;
    const preview = (await h.workflow.landmark_preview(
      { parallel: false, workerCount: 1 },
      h.context,
    )) as { preview: boolean };
    expect(preview.preview).toBe(true);
    expect(h.state.history).toHaveLength(entriesBeforePreview);
    expect(h.commit).toHaveBeenCalledTimes(commitsBeforePreview);
    expect(h.entity(movingId)).toBe(smoothed);
    const solved = h.session()!.preview!;
    expect(solved.diagnostics.algorithm).toBe("native-landmark-registration");
    expect(solved.registration!.pairs).toBe(3);
    near(solved.registration!.transform.rotation, [0, -1, 0, 1, 0, 0, 0, 0, 1]);
    near(solved.registration!.transform.translation, [10, 20, 30]);
    expect(solved.registration!.rms).toBeLessThan(1e-3);
    const accepted = h.workflow.landmark_accept({}, h.context) as {
      accepted: boolean;
    };
    expect(accepted.accepted).toBe(true);
    expect(h.state.history).toHaveLength(entriesBeforePreview + 1);
    expect(h.commit).toHaveBeenCalledTimes(commitsBeforePreview + 1);
    expect(h.state.history.at(-1)!.label).toBe("Align by corresponding points");
    const aligned = h.entity(movingId);
    near(
      aligned.positions,
      Array.from({ length: 4 }, (_, id) =>
        mappedPoint(beforeAlignmentPositions.slice(id * 3, id * 3 + 3)),
      ).flat(),
    );
    near(
      aligned.normals!,
      Array.from({ length: 4 }, (_, id) =>
        mappedNormal(beforeAlignmentNormals.slice(id * 3, id * 3 + 3)),
      ).flat(),
    );
    expect(aligned.normals).toHaveLength(12);
    expect(h.entity(fixed.id)).toBe(fixed);
    expect(Array.from(fixed.positions)).toEqual(fixedPositions);
    expect(Array.from(fixed.normals!)).toEqual(fixedNormals);
    expect(Array.from(authored.positions)).toEqual(authoredPositions);
    expect(Array.from(authored.normals!)).toEqual(authoredNormals);
    expect(authored).toEqual(authoredSnapshot);
    expect(fixed).toEqual(fixedSnapshot);
    expect(Array.from(smoothed.positions)).toEqual(beforeAlignmentPositions);
    expect(Array.from(smoothed.normals!)).toEqual(beforeAlignmentNormals);
    expect(InProcessWorker.instances).toHaveLength(5);
    for (const worker of InProcessWorker.instances) {
      expect(worker.closed).toBe(true);
      expect(worker.terminate).toHaveBeenCalledOnce();
    }
  },
  15_000,
);
