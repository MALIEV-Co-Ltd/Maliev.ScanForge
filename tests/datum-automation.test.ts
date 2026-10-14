import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { CadClient } from "../src/cad/client";
import type { Entity } from "../src/types";
import native from "./fixtures/alignment-datum-plane-native.json";
import cadTransforms from "./fixtures/alignment-datum-cad-transform-native.json";
import {
  executeDatumTransform,
  type DatumTransformRequest,
} from "../src/datum-transform-worker";
import type { NativeDatumPlaneState } from "../src/scan-native-datum-plane";
import { nativeDatumCadTransform } from "../src/scan-native-datum-cad-transform";
function setup() {
  const entity: Entity = {
    id: "scan",
    name: "scan",
    kind: "mesh",
    positions: new Float32Array([5, 6, 7, 6, 6, 7, 5, 7, 7]),
    color: "#fff",
    opacity: 1,
    visible: true,
  };
  const state: WorkspaceSnapshot = {
    name: "test",
    entities: [entity],
    history: [],
    future: [],
    authoring: {},
    selectedId: "scan",
    selection: null,
    settings: {},
  };
  let busy = false;
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => ({}) as CadClient,
    commit: vi.fn((entities, label) => {
      state.history.push({ entities: state.entities, label });
      state.entities = entities;
    }),
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => busy,
    activity: (value) => {
      busy = value;
    },
    showDatumPreview: vi.fn(),
    discardPreview: vi.fn(),
    present: vi.fn(async () => {}),
    inspectApplication: () => ({ previews: {} }),
  };
  const api = new ApplicationApi(host, createOperations(host));
  return { api, host, state };
}
async function settle(
  api: ApplicationApi,
  receipt: Awaited<ReturnType<ApplicationApi["invoke"]>>,
) {
  if (!receipt.ok) throw new Error(receipt.error.message);
  const jobId = (receipt.result as { jobId: string }).jobId;
  for (let i = 0; i < 200; i++) {
    const response = await api.invoke("job_get", { jobId });
    if (!response.ok) throw new Error(response.error.message);
    const job = response.result as {
      status: string;
      result: any;
      error?: { message: string; code: string };
    };
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Job did not settle");
}
const point = [{ kind: "point", point: [5, 6, 7], axis: 0 }];
function exactSetup() {
  const setupResult = setup();
  const { host, state } = setupResult;
  state.entities[0] = {
    ...state.entities[0],
    kind: "cad",
    kernelId: "source",
    brep: "original",
  };
  let next = 0;
  const release = vi.fn(async (_ids: string[]) => {});
  const transformDatum = vi.fn(
    async (_id: string, matrix: readonly number[]) => ({
      kernelId: `placed-${++next}`,
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      brep: "placed",
      placementMatrix: nativeDatumCadTransform(matrix),
    }),
  );
  host.cad = () => ({ transformDatum, release }) as unknown as CadClient;
  return { ...setupResult, release, transformDatum };
}
it("shares exact CAD Preview/Apply with MCP and releases only temporary handles", async () => {
  const { api, host, state, release, transformDatum } = exactSetup();
  try {
    for (let i = 0; i < 2; i++) {
      const preview = await settle(
        api,
        await api.invoke("alignment_preview", request(api)),
      );
      expect(preview.status).toBe("succeeded");
      expect(preview.result.targets[0].execution.backend).toBe("OpenCascade");
    }
    expect(release).toHaveBeenCalledWith(["placed-1"]);
    expect(state.entities[0].kernelId).toBe("source");
    expect(state.history).toHaveLength(0);
    const discard = await api.invoke("preview_discard", {
      target: "datum",
      expectedRevision: api.currentRevision(),
      requestId: "discard-exact",
    });
    expect(discard.ok).toBe(true);
    expect(release).toHaveBeenCalledWith(["placed-2"]);
    const apply = await settle(
      api,
      await api.invoke("alignment_apply", request(api)),
    );
    expect(apply.status).toBe("succeeded");
    expect(state.entities[0].kernelId).toBe("placed-3");
    expect(state.entities[0].brep).toBe("placed");
    expect(state.history[0].entities[0].kernelId).toBe("source");
    expect(host.commit).toHaveBeenCalledTimes(1);
    expect(transformDatum).toHaveBeenCalledTimes(3);
    expect(release.mock.calls.flatMap(([ids]) => ids)).toEqual([
      "placed-1",
      "placed-2",
    ]);
  } finally {
    api.dispose();
  }
});
it("releases exact CAD outputs on parity failure without committing", async () => {
  const { api, state, release, transformDatum } = exactSetup();
  transformDatum.mockImplementationOnce(async () => ({
    kernelId: "bad",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    brep: "bad",
    placementMatrix: Array(12).fill(0),
  }));
  try {
    const job = await settle(
      api,
      await api.invoke("alignment_apply", request(api)),
    );
    expect(job.status).toBe("failed");
    expect(job.error?.message).toMatch(/native frame/);
    expect(release).toHaveBeenCalledWith(["bad"]);
    expect(state.entities[0].kernelId).toBe("source");
    expect(state.history).toHaveLength(0);
  } finally {
    api.dispose();
  }
});
it("releases exact CAD outputs when cancelled during presentation", async () => {
  const { api, host, state, release } = exactSetup();
  let finish: undefined | (() => void);
  vi.mocked(host.present!).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  try {
    const receipt = await api.invoke("alignment_apply", request(api));
    for (let i = 0; i < 100 && !finish; i++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    expect(finish).toBeTypeOf("function");
    if (!receipt.ok) throw new Error(receipt.error.message);
    await api.invoke("job_cancel", {
      jobId: (receipt.result as { jobId: string }).jobId,
    });
    finish!();
    expect((await settle(api, receipt)).status).toBe("cancelled");
    expect(release).toHaveBeenCalledWith(["placed-1"]);
    expect(state.history).toHaveLength(0);
  } finally {
    api.dispose();
  }
});
it("publishes the original exact-CAD placement matrix through shared Preview and Apply", async () => {
  const { api, state } = setup(),
    sample = native.cases[0],
    expected = cadTransforms.cases.find(
      (item) =>
        item.name === "datum-plane-sequence-results.json-" + sample.name,
    )!;
  expect(expected).toBeDefined();
  const constraints = sample.steps.map((step) => ({
    kind: "plane",
    point: step.point,
    direction: step.normal,
    axis: step.axis,
  }));
  try {
    const preview = await settle(
      api,
      await api.invoke("alignment_preview", {
        entityIds: ["scan"],
        constraints,
        expectedRevision: api.currentRevision(),
        requestId: "cad-witness-preview",
      }),
    );
    expect(preview.status).toBe("succeeded");
    const output = Buffer.alloc(96);
    preview.result.cadMatrix.forEach((value: number, i: number) =>
      output.writeDoubleLE(value, i * 8),
    );
    expect(output.toString("hex")).toBe(expected.nativeMatrixBits);
    expect(state.history).toHaveLength(0);
    const applied = await settle(
      api,
      await api.invoke("alignment_apply", {
        entityIds: ["scan"],
        constraints,
        expectedRevision: api.currentRevision(),
        requestId: "cad-witness-apply",
      }),
    );
    expect(applied.status).toBe("succeeded");
    expect(applied.result.cadMatrix).toEqual(preview.result.cadMatrix);
  } finally {
    api.dispose();
  }
});
it("exposes admitted CPU workers and explicit serial fallback through the shared API", async () => {
  class WorkerAdapter {
    static instances: WorkerAdapter[] = [];
    stopped = false;
    onmessage?: (event: { data: unknown }) => void;
    constructor() {
      WorkerAdapter.instances.push(this);
    }
    postMessage(input: DatumTransformRequest, transfer: Transferable[]) {
      const copy = structuredClone(input, { transfer });
      queueMicrotask(() => {
        if (!this.stopped)
          this.onmessage?.({ data: executeDatumTransform(copy) });
      });
    }
    terminate() {
      this.stopped = true;
    }
  }
  vi.stubGlobal("Worker", WorkerAdapter);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
  const { api, state } = setup();
  state.entities[0] = {
    ...state.entities[0],
    kind: "pointcloud",
    positions: new Float32Array(1_100_000 * 3),
  };
  try {
    const parallel = await settle(
      api,
      await api.invoke("alignment_preview", {
        entityIds: ["scan"],
        constraints: point,
        parallel: true,
        expectedRevision: api.currentRevision(),
        requestId: "cpu-preview",
      }),
    );
    expect(parallel.status).toBe("succeeded");
    expect(parallel.result.targets[0].execution.physicalWorkers).toBe(2);
    expect(WorkerAdapter.instances.every((worker) => worker.stopped)).toBe(
      true,
    );
    const serial = await settle(
      api,
      await api.invoke("alignment_apply", {
        entityIds: ["scan"],
        constraints: point,
        parallel: false,
        expectedRevision: api.currentRevision(),
        requestId: "serial-apply",
      }),
    );
    expect(serial.status).toBe("succeeded");
    expect(serial.result.targets[0].execution).toMatchObject({
      physicalWorkers: 0,
      fallbackReason: "single-core requested",
    });
    expect(serial.result.targets[0].bounds).toEqual(
      parallel.result.targets[0].bounds,
    );
    expect(state.history).toHaveLength(1);
  } finally {
    api.dispose();
    vi.unstubAllGlobals();
  }
});
it("preserves native signed-zero normals through the shared Apply operation", async () => {
  const { api, state } = setup();
  state.entities[0].normals = Array(9).fill(-0);
  const original = state.entities[0];
  const result = await settle(
    api,
    await api.invoke("alignment_apply", {
      entityIds: ["scan"],
      constraints: point,
      expectedRevision: api.currentRevision(),
      requestId: "native-normal-signs",
    }),
  );
  expect(result.status).toBe("succeeded");
  expect(
    state.entities[0].normals?.every((value) => Object.is(value, -0)),
  ).toBe(true);
  expect(original.normals?.every((value) => Object.is(value, -0))).toBe(true);
  expect(state.history).toHaveLength(1);
});
it("resolves CAD references from current geometry and preserves GUI/MCP manual equivalence", async () => {
  const { api, host, state } = setup();
  state.entities.push({
    ...state.entities[0],
    id: "cad",
    kind: "cad",
    kernelId: "body",
    locked: true,
  });
  const input = {
    kind: "plane",
    faceIndex: 0,
    firstTriangle: 0,
    triangleCount: 2,
    evaluatedPoint: [3, 4, 5],
    derivativeU: [1, 0, 0],
    derivativeV: [0, 1, 0],
  };
  const read = vi.fn(async () => [input]);
  host.cad = () => ({ alignmentReferences: read }) as unknown as CadClient;
  const discovered = await settle(
    api,
    await api.invoke("alignment_references", { entityId: "cad" }),
  );
  const reference = discovered.result.references[0];
  const bound = [
    {
      kind: "reference",
      entityId: "cad",
      referenceId: reference.id,
      axis: 2,
      flip: true,
    },
  ];
  const preview = await settle(
    api,
    await api.invoke("alignment_preview", {
      entityIds: ["scan"],
      constraints: bound,
      expectedRevision: api.currentRevision(),
      requestId: "bound-preview",
    }),
  );
  const manual = await settle(
    api,
    await api.invoke("alignment_preview", {
      entityIds: ["scan"],
      constraints: [
        {
          kind: reference.kind,
          point: reference.point,
          direction: reference.direction,
          axis: 2,
          flip: true,
        },
      ],
      expectedRevision: api.currentRevision(),
      requestId: "manual-preview",
    }),
  );
  expect(preview.status).toBe("succeeded");
  expect(preview.result.matrix).toEqual(manual.result.matrix);
  expect(state.history).toHaveLength(0);
  const applied = await settle(
    api,
    await api.invoke("alignment_apply", {
      entityIds: ["scan"],
      constraints: bound,
      expectedRevision: api.currentRevision(),
      requestId: "bound-apply",
    }),
  );
  expect(applied.status).toBe("succeeded");
  expect(applied.result.matrix).toEqual(preview.result.matrix);
  expect(read).toHaveBeenCalledTimes(3);
  expect(state.entities[1].kernelId).toBe("body");
});
it("rejects stale, foreign and unsupported reference identities before committing", async () => {
  const { api, host, state } = setup();
  state.entities.push({
    ...state.entities[0],
    id: "cad",
    kind: "cad",
    kernelId: "body",
  });
  host.cad = () =>
    ({
      alignmentReferences: async () => [
        {
          kind: "unsupported",
          faceIndex: 0,
          firstTriangle: 0,
          triangleCount: 1,
          surfaceType: 7,
        },
      ],
    }) as unknown as CadClient;
  for (const referenceId of ["cad/face/0", "cad/face/99", "other/face/0"]) {
    const result = await settle(
      api,
      await api.invoke("alignment_apply", {
        entityIds: ["scan"],
        constraints: [
          { kind: "reference", entityId: "cad", referenceId, axis: 2 },
        ],
        expectedRevision: api.currentRevision(),
        requestId: referenceId,
      }),
    );
    expect(result.status).toBe("failed");
    expect(state.history).toHaveLength(0);
  }
});
it("binds fitted construction feature references without invoking CAD", async () => {
  const { api, host, state } = setup();
  state.entities.push({
    ...state.entities[0],
    id: "sphere",
    fit: {
      kind: "sphere",
      center: [5, 6, 7],
      axis: [0, 0, 1],
      radius: 2,
      rms: 0,
      maxError: 0,
    },
  });
  const cad = vi.fn(() => {
    throw new Error("CAD should not be needed");
  });
  host.cad = cad;
  const result = await settle(
    api,
    await api.invoke("alignment_apply", {
      entityIds: ["scan"],
      constraints: [
        {
          kind: "reference",
          entityId: "sphere",
          referenceId: "sphere/fit/point",
          axis: 0,
        },
      ],
      expectedRevision: api.currentRevision(),
      requestId: "fitted-point",
    }),
  );
  expect(result.status).toBe("succeeded");
  expect(state.entities[0].positions.slice(0, 3)).toEqual(
    new Float32Array([0, 0, 0]),
  );
  expect(cad).not.toHaveBeenCalled();
});
it("exposes frame-basis translation through preview and apply with matching output", async () => {
  const { api, state } = setup();
  const args = {
    entityIds: ["scan"],
    constraints: point,
    translation: [1.25, -2.5, 3.75],
    expectedRevision: api.currentRevision(),
  };
  const preview = await settle(
    api,
    await api.invoke("alignment_preview", {
      ...args,
      requestId: "offset-preview",
    }),
  );
  expect(preview.status).toBe("succeeded");
  expect(preview.result.translation).toEqual(args.translation);
  expect(preview.result.bounds).toBeUndefined();
  expect(preview.result.targets[0].bounds.min).toEqual([-1.25, 2.5, -3.75]);
  expect(state.history).toHaveLength(0);
  const applied = await settle(
    api,
    await api.invoke("alignment_apply", { ...args, requestId: "offset-apply" }),
  );
  expect(applied.status).toBe("succeeded");
  expect(applied.result.matrix).toEqual(preview.result.matrix);
  expect(state.entities[0].positions.slice(0, 3)).toEqual(
    new Float32Array([-1.25, 2.5, -3.75]),
  );
  expect(state.history).toHaveLength(1);
  const invalid = await api.invoke("alignment_preview", {
    ...args,
    translation: [1, 2],
    requestId: "invalid-offset",
    expectedRevision: api.currentRevision(),
  });
  expect(invalid.ok).toBe(false);
});
function request(api: ApplicationApi, constraints = point) {
  return {
    entityIds: ["scan"],
    constraints,
    expectedRevision: api.currentRevision(),
    requestId: crypto.randomUUID(),
  };
}
function bits(state: NativeDatumPlaneState) {
  const b = Buffer.alloc(0xe8),
    v = (values: number[], offset: number) =>
      values.forEach((value, i) => b.writeDoubleLE(value, offset + i * 8));
  v(state.matrix, 0);
  b.writeUInt32LE(state.flags, 0x60);
  b.writeInt32LE(state.stage, 0x64);
  v(state.anchor, 0x68);
  v(state.linePoint, 0x80);
  v(state.planePoint, 0x98);
  v(state.lineDirection, 0xb0);
  v(state.planeNormal, 0xc8);
  b.writeInt32LE(state.primaryAxis, 0xe0);
  b.writeInt32LE(state.secondaryAxis, 0xe4);
  return b.toString("hex");
}
it("previews through the native scan transform without committing geometry or history", async () => {
  const { api, host, state } = setup(),
    before = state.entities;
  try {
    const job = await settle(
      api,
      await api.invoke("alignment_preview", request(api)),
    );
    expect(job.status).toBe("succeeded");
    expect(job.result).toMatchObject({
      preview: true,
      committedGeometryPreserved: true,
      targets: [
        { entityId: "scan", bounds: { min: [0, 0, 0], max: [1, 1, 0] } },
      ],
    });
    expect(state.entities).toBe(before);
    expect(state.history).toHaveLength(0);
    expect(host.commit).not.toHaveBeenCalled();
    const shown = vi.mocked(host.showDatumPreview!).mock.calls[0][0]!;
    expect(Array.from(shown[0].positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  } finally {
    api.dispose();
  }
});
it("applies the same transform as one history step and retries without duplicate commits", async () => {
  const { api, host, state } = setup();
  try {
    const args = request(api),
      first = await api.invoke("alignment_apply", args);
    expect(await api.invoke("alignment_apply", args)).toEqual(first);
    const job = await settle(api, first);
    expect(job.status).toBe("succeeded");
    expect(job.result.changed).toBe(true);
    expect(state.history).toHaveLength(1);
    expect(host.commit).toHaveBeenCalledTimes(1);
    expect(Array.from(state.entities[0].positions)).toEqual([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]);
    expect(Array.from(state.history[0].entities[0].positions)).toEqual([
      5, 6, 7, 6, 6, 7, 5, 7, 7,
    ]);
    expect(host.showDatumPreview).toHaveBeenLastCalledWith(null);
  } finally {
    api.dispose();
  }
});
it("does not commit an identity alignment", async () => {
  const { api, host, state } = setup();
  try {
    const job = await settle(
      api,
      await api.invoke(
        "alignment_apply",
        request(api, [{ kind: "point", point: [0, 0, 0], axis: 0 }]),
      ),
    );
    expect(job.status).toBe("succeeded");
    expect(job.result.changed).toBe(false);
    expect(state.history).toHaveLength(0);
    expect(host.commit).not.toHaveBeenCalled();
  } finally {
    api.dispose();
  }
});
it("skips coordinate allocation and CPU workers for a large identity Apply", async () => {
  const { api, state } = setup();
  state.entities[0] = {
    ...state.entities[0],
    kind: "pointcloud",
    positions: new Float32Array(1_100_000 * 3),
  };
  const original = state.entities[0],
    factory = vi.fn(() => {
      throw new Error("Identity should not create workers");
    });
  vi.stubGlobal("Worker", factory);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
  try {
    const result = await settle(
      api,
      await api.invoke("alignment_apply", {
        entityIds: ["scan"],
        constraints: [{ kind: "point", point: [0, 0, 0], axis: 0 }],
        parallel: true,
        expectedRevision: api.currentRevision(),
        requestId: "large-no-op",
      }),
    );
    expect(result.status).toBe("succeeded");
    expect(result.result.changed).toBe(false);
    expect(result.result.targets[0].execution.fallbackReason).toBe(
      "identity transform",
    );
    expect(factory).not.toHaveBeenCalled();
    expect(state.entities[0]).toBe(original);
    expect(state.history).toHaveLength(0);
  } finally {
    api.dispose();
    vi.unstubAllGlobals();
  }
});
it("rejects incompatible constraints and unsupported targets before commit", async () => {
  const { api, host, state } = setup();
  try {
    const constraints = [
      { kind: "plane", point: [0, 0, 0], direction: [1, 0, 0], axis: 0 },
      { kind: "plane", point: [0, 0, 0], direction: [1, 0, 0], axis: 0 },
    ];
    const job = await settle(
      api,
      await api.invoke("alignment_apply", request(api, constraints)),
    );
    expect(job.status).toBe("failed");
    expect(job.error?.message).toMatch(/Reference 2/);
    state.entities = [{ ...state.entities[0], kernelId: "cad", locked: true }];
    expect(
      (await settle(api, await api.invoke("alignment_apply", request(api))))
        .status,
    ).toBe("failed");
    expect(host.commit).not.toHaveBeenCalled();
  } finally {
    api.dispose();
  }
});
it("cancels before the commit and restores the committed scene", async () => {
  const { api, host, state } = setup();
  let finish!: () => void;
  vi.mocked(host.present!).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  try {
    const receipt = await api.invoke("alignment_apply", request(api));
    if (!receipt.ok) throw new Error(receipt.error.message);
    for (let i = 0; i < 100 && !finish; i++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    expect(finish).toBeTypeOf("function");
    await api.invoke("job_cancel", {
      jobId: (receipt.result as { jobId: string }).jobId,
    });
    finish();
    const job = await settle(api, receipt);
    expect(job.status).toBe("cancelled");
    expect(state.history).toHaveLength(0);
    expect(host.commit).not.toHaveBeenCalled();
    expect(host.showDatumPreview).toHaveBeenLastCalledWith(null);
  } finally {
    api.dispose();
  }
});
it("aligns multiple scans atomically and preserves point-cloud normals", async () => {
  const { api, state, host } = setup();
  state.entities.push({
    ...state.entities[0],
    id: "cloud",
    kind: "pointcloud",
    positions: new Float32Array([5, 6, 7]),
    normals: [0, 0, 1],
  });
  try {
    const job = await settle(
      api,
      await api.invoke("alignment_apply", {
        ...request(api),
        entityIds: ["scan", "cloud"],
      }),
    );
    expect(job.status).toBe("succeeded");
    expect(host.commit).toHaveBeenCalledTimes(1);
    expect(state.history).toHaveLength(1);
    expect(Array.from(state.entities[1].positions)).toEqual([0, 0, 0]);
    expect(state.entities[1].normals).toEqual([0, 0, 1]);
    expect(job.result.targets[1]).toMatchObject({
      entityId: "cloud",
      kind: "pointcloud",
      count: 1,
    });
  } finally {
    api.dispose();
  }
});
it("validates the published scan/constraint schema", async () => {
  const { api } = setup();
  try {
    for (const change of [
      { entityIds: [] },
      { constraints: [] },
      { constraints: [{ kind: "plane", point: [0, 0, 0], axis: 0 }] },
      { constraints: [{ kind: "point", point: [0, 0, Infinity], axis: 0 }] },
    ])
      expect(
        await api.invoke("alignment_preview", { ...request(api), ...change }),
      ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  } finally {
    api.dispose();
  }
});
it.each(
  native.cases.filter(
    (sample) =>
      sample.steps.every((step, index) => step.stage === index) &&
      sample.steps.every((step) => step.accepted),
  ),
)("previews complete native state through MCP: $name", async (sample) => {
  const { api } = setup();
  try {
    const constraints = sample.steps.map((step) => ({
      kind: "plane",
      point: step.point,
      direction: step.normal,
      axis: step.axis,
    }));
    const job = await settle(
      api,
      await api.invoke("alignment_preview", request(api, constraints)),
    );
    expect(job.status).toBe("succeeded");
    expect(bits(job.result.frame)).toBe(sample.steps.at(-1)!.nativeBits);
  } finally {
    api.dispose();
  }
});
