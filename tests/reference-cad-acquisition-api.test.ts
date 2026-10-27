// Public gateway regression: promoted after parent-recorded RED.
// On promotion to tests/, replace ../src/ with ../src/.
import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { encodeReferenceGeometry } from "../src/reference-construction-values";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
} from "../src/project-file-codec";
import type { CadClient } from "../src/cad/client";
import type { Entity } from "../src/types";

const apis: ApplicationApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
  vi.restoreAllMocks();
});
const triangle = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
function fixture() {
  const cadEntity: Entity = {
    id: "cad",
    name: "Exact source",
    kind: "cad",
    kernelId: "kernel-1",
    brep: "immutable-brep-1",
    positions: [...triangle],
    visible: true,
    color: "#ffffff",
    opacity: 1,
  };
  const mesh: Entity = {
    id: "scan",
    name: "Original mesh",
    kind: "mesh",
    positions: triangle,
    visible: true,
    color: "#ffffff",
    opacity: 1,
  };
  const cloud: Entity = {
    id: "cloud",
    name: "Cloud",
    kind: "pointcloud",
    positions: new Float32Array([1, 2, 3]),
    visible: true,
    color: "#ffffff",
    opacity: 1,
  };
  const state: WorkspaceSnapshot = {
    name: "Acquisition",
    entities: [cadEntity, mesh, cloud],
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: null,
    selection: null,
  };
  let generation = 0;
  const coordinate = vi.fn(async (_kernelId: string, selection: any) => ({
    position:
      selection.kind === "vertex"
        ? [1.0000005, 0, 6.800000190734863]
        : selection.kind === "edge-endpoint"
          ? [0.00781254, 2, 3]
          : [0.5, 2, 3],
  }));
  const features = vi.fn(async (_kernelId: string, args: any) => {
    const rows =
      args.family === "vertices"
        ? [
            {
              index: 0,
              position: [1.0000005, 0, 6.800000190734863],
              eligible: true,
            },
          ]
        : args.family === "edges"
          ? [
              {
                index: 0,
                firstParameter: 0,
                lastParameter: 2,
                degenerate: false,
                eligible: true,
              },
            ]
          : [
              {
                index: 0,
                faceIndex: 0,
                firstTriangle: 0,
                triangleCount: 1,
                eligible: true,
              },
            ];
    return {
      total: rows.length,
      nextOffset: null,
      rows: rows.slice(
        args.offset ?? 0,
        (args.offset ?? 0) + (args.limit ?? 50),
      ),
    };
  });
  const canonical = vi.fn(async () => ({
    vertices: triangle,
    triangles: new Uint32Array([0, 1, 2]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  }));
  const faceRows = vi.fn(async () => [
    {
      kind: "plane",
      faceIndex: 0,
      firstTriangle: 0,
      triangleCount: 1,
      evaluatedPoint: [0, 0, 0],
      derivativeU: [1, 0, 0],
      derivativeV: [0, 1, 0],
    },
  ]);
  const release = vi.fn(async () => {});
  let client = {
    referenceCoordinate: coordinate,
    referenceFeatures: features,
    alignmentMesh: canonical,
    alignmentReferences: faceRows,
    release,
    get referenceGeneration() {
      return generation;
    },
  } as unknown as CadClient;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0.5, 0.5, 10);
  camera.lookAt(0.5, 0.5, 0);
  camera.updateMatrixWorld(true);
  const view = {
    projection: "orthographic",
    cameraMatrixFormat: "column-major-4x4",
    projectionMatrix: camera.projectionMatrix.toArray(),
    cameraWorldMatrix: camera.matrixWorld.toArray(),
    viewport: {
      width: 100,
      height: 100,
      coordinates: "normalized top-left x/y in [0,1]",
    },
    clippingPlanes: [] as { normal: number[]; constant: number }[],
  };
  const commit = vi.fn<WorkspaceHost["commit"]>((next, label) => {
    state.history.push({ entities: state.entities, label });
    state.entities = next;
    state.future = [];
  });
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => client,
    commit,
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
    showReferenceConstructionPreview: vi.fn(),
    inspectApplication: () => ({ previews: {} }),
    undo: () => {
      const r = state.history.pop()!;
      state.future.push({ entities: state.entities, label: r.label });
      state.entities = r.entities;
    },
    redo: () => {
      const r = state.future.pop()!;
      state.history.push({ entities: state.entities, label: r.label });
      state.entities = r.entities;
    },
  };
  // New narrow camera/clip snapshot, not the ordinary rendered-hit picker.
  Object.assign(host, { referenceCoordinateView: vi.fn(() => view) });
  const api = new ApplicationApi(host, createOperations(host));
  apis.push(api);
  const invoke = (command: string, args: Record<string, unknown>) =>
    api.invoke(command, {
      ...args,
      ...([
        "reference_construct",
        "reference_construction_acquire",
        "object_delete",
      ].includes(command)
        ? {
            expectedRevision: api.currentRevision(),
            requestId: crypto.randomUUID(),
          }
        : {}),
    });
  return {
    api,
    host,
    state,
    cadEntity,
    mesh,
    cloud,
    view,
    commit,
    coordinate,
    features,
    canonical,
    release,
    invoke,
    reset: () => generation++,
    replaceClient: () => {
      client = {
        ...client,
        referenceGeneration: generation,
      } as unknown as CadClient;
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
async function value(p: ReturnType<ApplicationApi["invoke"]>): Promise<any> {
  const r = await p;
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) throw Error(r.error.message);
  return r.result;
}
async function finish(h: Fixture, receipt: any) {
  for (let i = 0; i < 100; i++) {
    const j = await value(h.api.invoke("job_get", { jobId: receipt.jobId }));
    if (j.status !== "running") return j;
    await Promise.resolve();
  }
  throw Error("Mocked acquisition did not settle");
}
async function acquire(
  h: Fixture,
  selection: any = { kind: "vertex", vertexIndex: 0 },
  entityId = "cad",
) {
  const receipt = await value(
    h.invoke("reference_construction_acquire", { entityId, selection }),
  );
  const j = await finish(h, receipt);
  expect(j.status, JSON.stringify(j)).toBe("succeeded");
  return { jobId: receipt.jobId, result: j.result };
}
async function preview(
  h: Fixture,
  jobId: string,
  other: Record<string, unknown> = {},
) {
  return value(
    h.invoke("reference_construct", {
      action: "preview",
      kind: "point",
      positionPick: { acquisitionJobId: jobId },
      ...other,
    }),
  );
}
async function apply(h: Fixture, p: any) {
  return value(
    h.invoke("reference_construct", {
      action: "apply",
      sessionId: p.sessionId,
      version: p.version,
    }),
  );
}
const encoding = (position: [number, number, number]) =>
  encodeReferenceGeometry({ kind: "point", position });

it("discovers the async bridge while preserving the existing synchronous cloud pick", async () => {
  const h = fixture(),
    d = await value(
      h.api.invoke("tools_search", {
        query: "reference_construction",
        includeSchemas: true,
        limit: 20,
      }),
    );
  expect(
    d.tools.find((r: any) => r.name === "reference_construction_acquire"),
  ).toMatchObject({ readOnly: true, job: true });
  expect(
    d.tools.find((r: any) => r.name === "reference_construction_features"),
  ).toMatchObject({ readOnly: true, job: true });
  expect(
    d.tools.find((r: any) => r.name === "reference_construction_pick"),
  ).toMatchObject({ readOnly: true, job: false });
  expect(
    await value(
      h.api.invoke("reference_construction_pick", {
        entityId: "cloud",
        pointIndex: 0,
      }),
    ),
  ).toMatchObject({ position: [1, 2, 3] });
  expect((await value(h.api.invoke("session_get", {}))).jobs).toHaveLength(0);
});
it("lists bounded topology pages read-only and rejects limit101 without starting work", async () => {
  const h = fixture(),
    before = h.state.entities,
    revision = h.api.currentRevision();
  const j = await finish(
    h,
    await value(
      h.api.invoke("reference_construction_features", {
        entityId: "cad",
        family: "vertices",
        offset: 0,
        limit: 100,
      }),
    ),
  );
  expect(j.status).toBe("succeeded");
  expect(j.result).toMatchObject({
    entityId: "cad",
    sourceRevision: revision,
    total: 1,
    nextOffset: null,
    rows: [{ index: 0, eligible: true }],
  });
  const calls = h.features.mock.calls.length;
  expect(
    await h.api.invoke("reference_construction_features", {
      entityId: "cad",
      family: "edges",
      limit: 101,
    }),
  ).toMatchObject({ ok: false });
  expect(h.features).toHaveBeenCalledTimes(calls);
  expect(h.state.entities).toBe(before);
  expect(h.commit).not.toHaveBeenCalled();
});
it("allows feature and acquisition jobs during an owned reference preview without replacing its version", async () => {
  const h = fixture();
  const owned = await value(
    h.invoke("reference_construct", {
      action: "preview",
      kind: "point",
      position: [8, 9, 10],
    }),
  );
  const page = await finish(
    h,
    await value(
      h.api.invoke("reference_construction_features", {
        entityId: "cad",
        family: "vertices",
      }),
    ),
  );
  expect(page.status).toBe("succeeded");
  const acquired = await acquire(h);
  expect(
    await value(h.api.invoke("reference_construction_get", {})),
  ).toMatchObject({
    sessionId: owned.sessionId,
    version: owned.version,
    geometryEncoding: owned.geometryEncoding,
  });
  const changed = await preview(h, acquired.jobId, {
    sessionId: owned.sessionId,
    version: owned.version,
  });
  expect(changed.sessionId).toBe(owned.sessionId);
  expect(changed.version).toBeGreaterThan(owned.version);
  expect(h.commit).not.toHaveBeenCalled();
});
it("rejects ambiguous hidden CAD display slots instead of applying them to unrelated canonical slots", async () => {
  const h = fixture();
  h.cadEntity.meshSelection = { hidden: [0] } as Entity["meshSelection"];
  const job = await finish(
    h,
    await value(
      h.invoke("reference_construction_acquire", {
        entityId: "cad",
        selection: { kind: "screen", x: 0.5, y: 0.5 },
      }),
    ),
  );
  expect(job.status).toBe("failed");
  expect(job.error.message).toMatch(/hidden|canonical/i);
  expect(h.canonical).not.toHaveBeenCalled();
  expect(h.commit).not.toHaveBeenCalled();
});
it("acquires an exact CAD vertex through preciseDouble fixed6/G15 rather than the cloud F32 bake", async () => {
  const h = fixture(),
    revision = h.api.currentRevision(),
    a = await acquire(h);
  expect(a.result).toMatchObject({
    entityId: "cad",
    sourceRevision: revision,
    position: [1.000001, 0, 6.8],
    positionEncoding: encoding([1.000001, 0, 6.8]),
    units: "mm",
    coordinateSpace: "world",
    numericOnly: true,
    sourceDependencyRetained: false,
  });
  expect(a.result).not.toHaveProperty("kernelId");
  expect(a.result).not.toHaveProperty("brep");
  expect(h.release).not.toHaveBeenCalled();
  expect(h.api.currentRevision()).toBe(revision);
});
it("acquires a finite curve endpoint without the point editor N7 pre-round", async () => {
  const h = fixture(),
    a = await acquire(h, {
      kind: "edge-endpoint",
      edgeIndex: 0,
      endpoint: "start",
    });
  expect(a.result.position).toEqual([0.007813, 2, 3]);
  expect(h.coordinate).toHaveBeenCalledWith("kernel-1", {
    kind: "edge-endpoint",
    edgeIndex: 0,
    endpoint: "start",
  });
});
it("consumes an explicit curve fraction once and retains no curve dependency after numeric Apply", async () => {
  const h = fixture(),
    a = await acquire(h, {
      kind: "edge-fraction",
      edgeIndex: 0,
      fraction: 0.25,
    }),
    p = await preview(h, a.jobId),
    made = await apply(h, p);
  expect(
    h.state.entities.find((r) => r.id === made.entityId)!.reference!.definition,
  ).toMatchObject({ mode: "coordinates", position: [0.5, 2, 3], sources: [] });
  expect(h.state.history).toHaveLength(1);
});
it("uses canonical face conversion and captured camera for normalized screen acquisition", async () => {
  const h = fixture(),
    a = await acquire(h, { kind: "screen", x: 0.5, y: 0.5, faceIndex: 0 });
  expect(a.result).toMatchObject({
    position: [0.5, 0.5, 0],
    selectionModel: "application-canonical-triangle",
  });
  expect(h.canonical).toHaveBeenCalledWith("kernel-1", {
    referenceAcquisition: true,
  });
  expect(h.coordinate).not.toHaveBeenCalled();
});
it("acquires source-mesh surface input without passing visible triangle or barycentric fields", async () => {
  const h = fixture(),
    before = Array.from(h.mesh.positions),
    a = await acquire(h, { kind: "screen", x: 0.5, y: 0.5 }, "scan");
  expect(a.result.positionEncoding).toEqual(encoding([0.5, 0.5, 0]));
  expect(h.coordinate).not.toHaveBeenCalled();
  expect(Array.from(h.mesh.positions)).toEqual(before);
});
it("uses validated original indexed mesh IDs consistently for pages, vertices and screen topology", async () => {
  const h = fixture();
  const vertices = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 2, 0]);
  const triangles = new Uint32Array([0, 1, 2, 1, 3, 2]);
  h.mesh.positions = new Float32Array(
    Array.from(triangles).flatMap((index) =>
      Array.from(vertices.subarray(index * 3, index * 3 + 3)),
    ),
  );
  h.mesh.indexedMesh = { vertices, triangles };
  const positions = h.mesh.positions;
  const page = await finish(
    h,
    await value(
      h.api.invoke("reference_construction_features", {
        entityId: "scan",
        family: "vertices",
      }),
    ),
  );
  expect(page.status).toBe("succeeded");
  expect(page.result).toMatchObject({
    total: 4,
    rows: [
      { index: 0 },
      { index: 1 },
      { index: 2 },
      { index: 3, position: [2, 2, 0] },
    ],
  });
  expect(
    (await acquire(h, { kind: "vertex", vertexIndex: 3 }, "scan")).result
      .position,
  ).toEqual([2, 2, 0]);
  expect(
    (await acquire(h, { kind: "screen", x: 1, y: 0 }, "scan")).result.position,
  ).toEqual([1.5, 1.5, 0]);
  expect(h.mesh.positions).toBe(positions);
  expect(h.mesh.indexedMesh.vertices).toBe(vertices);
  expect(h.mesh.indexedMesh.triangles).toBe(triangles);
  expect(h.commit).not.toHaveBeenCalled();
});
it("uses only the successful owned acquisition job for exact synchronous Preview/Get/Apply", async () => {
  const h = fixture(),
    a = await acquire(h);
  // Later camera movement does not change an already acquired world point.
  h.view.cameraWorldMatrix[12] += 1;
  const p = await preview(h, a.jobId);
  expect(p.geometryEncoding).toEqual(a.result.positionEncoding);
  expect(
    (await value(h.api.invoke("reference_construction_get", {})))
      .geometryEncoding,
  ).toEqual(p.geometryEncoding);
  await value(
    h.invoke("reference_construct", {
      action: "cancel",
      sessionId: p.sessionId,
      version: p.version,
    }),
  );
  const b = await acquire(h, {
    kind: "edge-endpoint",
    edgeIndex: 0,
    endpoint: "start",
  });
  const endpoints = await value(
    h.invoke("reference_construct", {
      action: "preview",
      kind: "line",
      startPick: { acquisitionJobId: a.jobId },
      endPick: { acquisitionJobId: b.jobId },
    }),
  );
  expect(endpoints.definition).toMatchObject({
    mode: "endpoints",
    start: [1.000001, 0, 6.8],
    end: [0.007813, 2, 3],
    sources: [],
    records: [],
  });
  const made = await apply(h, endpoints);
  expect(
    encodeReferenceGeometry(
      h.state.entities.find((r) => r.id === made.entityId)!.reference!.geometry,
    ),
  ).toEqual(endpoints.geometryEncoding);
  expect(h.commit).toHaveBeenCalledOnce();
});
it("protects retained acquisition data from nested job_get result alias mutation", async () => {
  const h = fixture(),
    a = await acquire(h),
    row = await value(h.api.invoke("job_get", { jobId: a.jobId }));
  try {
    row.result.position[0] = 999;
    row.result.positionEncoding.bits = "00";
  } catch {
    /* A frozen small public result is also valid. */
  }
  expect(
    (await value(h.api.invoke("job_get", { jobId: a.jobId }))).result
      .positionEncoding,
  ).toEqual(encoding([1.000001, 0, 6.8]));
  expect((await preview(h, a.jobId)).geometryEncoding).toEqual(
    encoding([1.000001, 0, 6.8]),
  );
});
it("rejects a successful feature-list job as an acquisition authority", async () => {
  const h = fixture(),
    r = await value(
      h.api.invoke("reference_construction_features", {
        entityId: "cad",
        family: "vertices",
      }),
    );
  await finish(h, r);
  expect(
    await h.invoke("reference_construct", {
      action: "preview",
      kind: "point",
      positionPick: { acquisitionJobId: r.jobId },
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/acquisition|command/i) },
  });
  expect(h.commit).not.toHaveBeenCalled();
});
it("rejects a still-running acquisition and publishes no numeric preview", async () => {
  const h = fixture();
  let resolve!: (v: any) => void;
  h.coordinate.mockImplementationOnce(
    () => new Promise<any>((r) => (resolve = r)),
  );
  const r = await value(
    h.invoke("reference_construction_acquire", {
      entityId: "cad",
      selection: { kind: "vertex", vertexIndex: 0 },
    }),
  );
  expect(
    await h.invoke("reference_construct", {
      action: "preview",
      kind: "point",
      positionPick: { acquisitionJobId: r.jobId },
    }),
  ).toMatchObject({ ok: false });
  resolve({ position: [1, 2, 3] });
  await finish(h, r);
  expect(h.host.showReferenceConstructionPreview).not.toHaveBeenCalled();
});
it("rejects failed and cancelled acquisition jobs even if a late worker produced coordinates", async () => {
  for (const cancelled of [false, true]) {
    const h = fixture();
    let settle!: (v: any) => void;
    h.coordinate.mockImplementationOnce(
      () =>
        new Promise<any>((resolve, reject) => {
          settle = cancelled ? resolve : reject;
        }),
    );
    const r = await value(
      h.invoke("reference_construction_acquire", {
        entityId: "cad",
        selection: { kind: "vertex", vertexIndex: 0 },
      }),
    );
    if (cancelled) await value(h.api.invoke("job_cancel", { jobId: r.jobId }));
    settle(cancelled ? { position: [1, 2, 3] } : Error("query rejected"));
    const j = await finish(h, r);
    expect(j.status).toBe(cancelled ? "cancelled" : "failed");
    expect(
      await h.invoke("reference_construct", {
        action: "preview",
        kind: "point",
        positionPick: { acquisitionJobId: r.jobId },
      }),
    ).toMatchObject({ ok: false });
    expect(h.state.history).toHaveLength(0);
    expect(h.release).not.toHaveBeenCalled();
  }
});
it("rejects an acquisition job from a different workspace API owner", async () => {
  const a = fixture(),
    b = fixture(),
    j = await acquire(a);
  expect(
    await b.invoke("reference_construct", {
      action: "preview",
      kind: "point",
      positionPick: { acquisitionJobId: j.jobId },
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/retained|job|found|owner/i) },
  });
  expect(b.commit).not.toHaveBeenCalled();
});
it("rejects an evicted acquisition using the existing32-job retention window", async () => {
  const h = fixture(),
    a = await acquire(h);
  for (let i = 0; i < 32; i++)
    await finish(
      h,
      await value(
        h.api.invoke("reference_construction_features", {
          entityId: "cad",
          family: "vertices",
        }),
      ),
    );
  expect(
    await h.invoke("reference_construct", {
      action: "preview",
      kind: "point",
      positionPick: { acquisitionJobId: a.jobId },
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/retained|job|found|expired/i) },
  });
  expect(h.commit).not.toHaveBeenCalled();
});
it("rejects obsolete feature-page revisions instead of resolving a rebuilt index", async () => {
  const h = fixture(),
    revision = h.api.currentRevision();
  h.cadEntity.kernelId = "rebuilt-kernel";
  expect(
    await h.api.invoke("reference_construction_acquire", {
      entityId: "cad",
      selection: { kind: "vertex", vertexIndex: 0 },
      expectedRevision: revision,
    }),
  ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  expect(h.coordinate).not.toHaveBeenCalled();
});
it("rejects source changes after await before retaining a successful acquisition", async () => {
  const h = fixture();
  let resolve!: (v: any) => void;
  h.coordinate.mockImplementationOnce(
    () => new Promise<any>((r) => (resolve = r)),
  );
  const r = await value(
    h.invoke("reference_construction_acquire", {
      entityId: "cad",
      selection: { kind: "vertex", vertexIndex: 0 },
    }),
  );
  h.cadEntity.brep = "changed-during-await";
  resolve({ position: [1, 2, 3] });
  expect((await finish(h, r)).status).toBe("failed");
  expect(h.commit).not.toHaveBeenCalled();
  expect(h.state.history).toHaveLength(0);
});
it("checks source object and BREP identity at Preview even when currentRevision alone misses the change", async () => {
  for (const replacement of [false, true]) {
    const h = fixture(),
      a = await acquire(h),
      revision = h.api.currentRevision();
    if (replacement)
      h.state.entities = h.state.entities.map((r) =>
        r.id === "cad" ? { ...r } : r,
      );
    else h.cadEntity.brep = "replacement-brep";
    expect(h.api.currentRevision()).toBe(revision);
    expect(
      await h.invoke("reference_construct", {
        action: "preview",
        kind: "point",
        positionPick: { acquisitionJobId: a.jobId },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        message: expect.stringMatching(/source|changed|identity|brep/i),
      },
    });
    expect(h.commit).not.toHaveBeenCalled();
  }
});
it("releases trusted source witnesses on identity-only GUI publication while retaining the small public receipt", async () => {
  const h = fixture(),
    acquired = await acquire(h);
  const row = (
    h.api as unknown as {
      jobs: Map<string, { privateData?: unknown; result?: unknown }>;
    }
  ).jobs.get(acquired.jobId)!;
  expect(row.privateData).toBeDefined();
  const revision = h.api.currentRevision();
  h.state.entities = h.state.entities.map((entity) =>
    entity.id === "cad"
      ? { ...entity, brep: "replacement-untracked-brep" }
      : entity,
  );
  expect(h.api.currentRevision()).toBe(revision);
  (
    h.api as unknown as { observeModelPublication(): void }
  ).observeModelPublication();
  // No subsequent invoke/currentRevision call may be needed to drop the old source.
  expect(row.privateData).toBeUndefined();
  expect(row.result).toEqual(acquired.result);
  expect(
    await h.invoke("reference_construct", {
      action: "preview",
      kind: "point",
      positionPick: { acquisitionJobId: acquired.jobId },
    }),
  ).toMatchObject({ ok: false });
  expect(h.commit).not.toHaveBeenCalled();
});
it("checks CAD client identity and worker generation independently of entity kernel strings", async () => {
  for (const replace of [false, true]) {
    const h = fixture(),
      a = await acquire(h),
      revision = h.api.currentRevision();
    if (replace) h.replaceClient();
    else h.reset();
    expect(h.api.currentRevision()).toBe(revision);
    expect(
      await h.invoke("reference_construct", {
        action: "preview",
        kind: "point",
        positionPick: { acquisitionJobId: a.jobId },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        message: expect.stringMatching(
          /kernel|client|generation|reset|changed/i,
        ),
      },
    });
    expect(h.commit).not.toHaveBeenCalled();
  }
});
it("rejects caller coordinates/bits/topology internals and mixed acquisition selectors", async () => {
  const h = fixture();
  for (const args of [
    {
      entityId: "cad",
      selection: { kind: "vertex", vertexIndex: 0 },
      position: [1, 2, 3],
    },
    {
      entityId: "cad",
      selection: { kind: "vertex", vertexIndex: 0, kernelId: "forged" },
    },
    {
      entityId: "cad",
      selection: { kind: "edge-fraction", edgeIndex: 0, fraction: 1.1 },
    },
    {
      entityId: "cad",
      selection: {
        kind: "screen",
        x: 0.5,
        y: 0.5,
        triangleIndex: 0,
        triangleCoordinates: [0.2, 0.3],
      },
    },
  ])
    expect(
      await h.invoke("reference_construction_acquire", args),
    ).toMatchObject({ ok: false });
  expect(h.coordinate).not.toHaveBeenCalled();
  expect(
    await h.invoke("reference_construct", {
      action: "preview",
      kind: "point",
      positionPick: {
        acquisitionJobId: "forged",
        entityId: "cad",
        pointIndex: 0,
      },
    }),
  ).toMatchObject({ ok: false });
});
it("uses the same visible unlocked selectable admission and rejects sampled-only mesh acquisition", async () => {
  for (const flags of [
    { visible: false },
    { locked: true },
    { selectable: false },
  ]) {
    const h = fixture();
    Object.assign(h.cadEntity, flags);
    const j = await finish(
      h,
      await value(
        h.invoke("reference_construction_acquire", {
          entityId: "cad",
          selection: { kind: "vertex", vertexIndex: 0 },
        }),
      ),
    );
    expect(j.status).toBe("failed");
    expect(h.coordinate).not.toHaveBeenCalled();
  }
  const h = fixture();
  h.mesh.scanSource = { bytes: 100, triangles: 100, displayedTriangles: 1 };
  const j = await finish(
    h,
    await value(
      h.invoke("reference_construction_acquire", {
        entityId: "scan",
        selection: { kind: "screen", x: 0.5, y: 0.5 },
      }),
    ),
  );
  expect(j.status).toBe("failed");
  expect(j.error.message).toMatch(/sample|original|source/i);
});
it("rejects a camera or clipping-state change during canonical acquisition without mutating source buffers", async () => {
  for (const cameraChange of [false, true]) {
    const h = fixture(),
      bytes = Array.from(triangle);
    let resolve!: (v: any) => void;
    h.canonical.mockImplementationOnce(
      () => new Promise<any>((r) => (resolve = r)),
    );
    const r = await value(
      h.invoke("reference_construction_acquire", {
        entityId: "cad",
        selection: { kind: "screen", x: 0.5, y: 0.5, faceIndex: 0 },
      }),
    );
    if (cameraChange) h.view.cameraWorldMatrix[12] += 1;
    else h.view.clippingPlanes.push({ normal: [0, 0, 1], constant: -1 });
    resolve({
      vertices: triangle,
      triangles: new Uint32Array([0, 1, 2]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    });
    const j = await finish(h, r);
    expect(j.status).toBe("failed");
    expect(j.error.message).toMatch(/camera|view|clip|changed/i);
    expect(Array.from(triangle)).toEqual(bytes);
    expect(h.commit).not.toHaveBeenCalled();
  }
});
it("keeps accepted numeric geometry detached across source deletion/history/reopen without storing acquisition IDs", async () => {
  const h = fixture(),
    a = await acquire(h),
    p = await preview(h, a.jobId),
    made = await apply(h, p);
  await value(h.invoke("object_delete", { entityId: "cad" }));
  const accepted = h.state.entities.find((r) => r.id === made.entityId)!;
  expect(accepted.reference!.definition).toMatchObject({
    mode: "coordinates",
    sources: [],
  });
  expect(accepted.reference).not.toHaveProperty("acquisitionJobId");
  const session = {
    project: {
      format: "maliev-scanforge" as const,
      version: 1 as const,
      units: "mm" as const,
      name: h.state.name,
      entities: h.state.entities,
      authoring: h.state.authoring,
    },
    history: h.state.history,
    future: h.state.future,
  };
  const reopened = await decodeProjectContents(
    await encodeProjectFileLocally(session),
  );
  expect(
    encodeReferenceGeometry(
      reopened.project.entities.find((r) => r.id === made.entityId)!.reference!
        .geometry,
    ),
  ).toEqual(p.geometryEncoding);
  expect(h.state.history).toHaveLength(2);
  expect(h.release).not.toHaveBeenCalled();
});
