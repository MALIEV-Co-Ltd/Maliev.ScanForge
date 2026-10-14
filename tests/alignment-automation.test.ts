import { describe, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { CadClient } from "../src/cad/client";
import type { CadAlignmentInput } from "../src/cad/alignment-reference";
import type { Entity } from "../src/types";
import planes from "./fixtures/alignment-datum-cad-plane-native.json";
import axes from "./fixtures/alignment-datum-cad-axis-native.json";
function decode(hex: string) {
  const b = Buffer.from(hex, "hex");
  return Array.from({ length: b.length / 8 }, (_, i) => b.readDoubleLE(i * 8));
}
function bits(values: number[]) {
  const b = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => b.writeDoubleLE(v, i * 8));
  return b.toString("hex");
}
function setup(input: CadAlignmentInput[] = []) {
  const entities: Entity[] = [
    {
      id: "cad",
      name: "CAD",
      kind: "cad",
      kernelId: "native-body",
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      color: "#ffffff",
      opacity: 1,
      visible: true,
      locked: true,
    },
  ];
  const state: WorkspaceSnapshot = {
    name: "test",
    entities,
    history: [],
    future: [],
    authoring: {},
    selectedId: "cad",
    selection: null,
    settings: {},
  };
  const read = vi.fn(async () => input);
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => ({ alignmentReferences: read }) as unknown as CadClient,
    commit: vi.fn(),
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
  };
  const api = new ApplicationApi(host, createOperations(host));
  return { api, host, state, read };
}
async function settle(
  api: ApplicationApi,
  receipt: Awaited<ReturnType<ApplicationApi["invoke"]>>,
) {
  if (!receipt.ok) throw new Error(receipt.error.message);
  const jobId = (receipt.result as { jobId: string }).jobId;
  for (let i = 0; i < 100; i++) {
    const response = await api.invoke("job_get", { jobId });
    if (!response.ok) throw new Error(response.error.message);
    const result = response.result as {
      status: string;
      result: any;
      error?: { code: string };
    };
    if (result.status !== "running") return result;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Job did not settle");
}
describe("MCP alignment reference discovery", () => {
  it("maps original render triangle slots to exact half-open CAD face ranges", async () => {
    const { api, host } = setup([
      {
        kind: "plane",
        faceIndex: 0,
        firstTriangle: 0,
        triangleCount: 2,
        evaluatedPoint: [0, 0, 0],
        derivativeU: [1, 0, 0],
        derivativeV: [0, 1, 0],
      },
      {
        kind: "unsupported",
        faceIndex: 1,
        firstTriangle: 2,
        triangleCount: 3,
        surfaceType: 3,
      },
    ]);
    try {
      for (const triangleIndex of [0, 1, 2, 4]) {
        const job = await settle(
          api,
          await api.invoke("alignment_references", {
            entityId: "cad",
            triangleIndex,
          }),
        );
        expect(job.status).toBe("succeeded");
        expect(job.result.references).toHaveLength(1);
        expect(job.result.references[0].faceIndex).toBe(
          triangleIndex < 2 ? 0 : 1,
        );
      }
      const missing = await settle(
        api,
        await api.invoke("alignment_references", {
          entityId: "cad",
          triangleIndex: 5,
        }),
      );
      expect(missing.status).toBe("failed");
      const invalid = await api.invoke("alignment_references", {
        entityId: "cad",
        triangleIndex: -1,
      });
      expect(invalid.ok).toBe(false);
      expect(host.commit).not.toHaveBeenCalled();
    } finally {
      api.dispose();
    }
  });
  it("is discoverable with bounded, strict schemas", async () => {
    const { api } = setup();
    try {
      const result = await api.invoke("tools_search", {
        query: "alignment references",
        includeSchemas: true,
      });
      expect(result).toMatchObject({
        ok: true,
        result: {
          tools: expect.arrayContaining([
            expect.objectContaining({
              name: "alignment_references",
              readOnly: true,
              job: true,
            }),
          ]),
        },
      });
      for (const patch of [
        { limit: 101 },
        { offset: -1 },
        { centerAt: [1, 2] },
        { centerAt: [1, 2, Infinity] },
        { extra: true },
      ])
        expect(
          await api.invoke("alignment_references", {
            entityId: "cad",
            ...patch,
          }),
        ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    } finally {
      api.dispose();
    }
  });
  it.each(planes.cases)(
    "publishes original planar output bytes: $name",
    async (sample) => {
      const { api, host, read } = setup([
        {
          faceIndex: 0,
          firstTriangle: 0,
          triangleCount: 1,
          kind: "plane",
          evaluatedPoint: decode(sample.pointBits) as [number, number, number],
          derivativeU: decode(sample.duBits) as [number, number, number],
          derivativeV: decode(sample.dvBits) as [number, number, number],
        },
      ]);
      try {
        const job = await settle(
          api,
          await api.invoke("alignment_references", {
            entityId: "cad",
            ...(sample.centered
              ? { centerAt: decode(sample.referenceBits) }
              : {}),
          }),
        );
        expect(job.status).toBe("succeeded");
        const reference = job.result.references[0];
        expect(bits(reference.point)).toBe(sample.nativePointBits);
        expect(bits(reference.direction)).toBe(sample.nativeNormalBits);
        expect(read).toHaveBeenCalledWith("native-body");
        expect(host.commit).not.toHaveBeenCalled();
        expect(api.currentRevision()).toBe(0);
      } finally {
        api.dispose();
      }
    },
  );
  it.each(axes.cases)(
    "publishes original axial output bytes: $name",
    async (sample) => {
      const p = decode(sample.primitiveBits),
        bounds = decode(sample.boundsBits);
      const { api } = setup([
        {
          faceIndex: 2,
          firstTriangle: 20,
          triangleCount: 7,
          kind: sample.kind as "cylinder" | "cone" | "torus",
          location: p.slice(0, 3) as [number, number, number],
          axis: p.slice(3, 6) as [number, number, number],
          firstV: bounds[2],
          lastV: bounds[3],
          radius: p[12],
          semiAngle: p[13],
        },
      ]);
      try {
        const job = await settle(
          api,
          await api.invoke("alignment_references", { entityId: "cad" }),
        );
        expect(job.status).toBe("succeeded");
        const reference = job.result.references[0];
        expect(bits(reference.point)).toBe(sample.nativePointBits);
        expect(bits(reference.direction)).toBe(sample.nativeAxisBits);
        expect(bits([reference.length])).toBe(sample.nativeLengthBits);
        expect(reference).toMatchObject({
          id: "cad/face/2",
          firstTriangle: 20,
          triangleCount: 7,
        });
      } finally {
        api.dispose();
      }
    },
  );
  it("pages unsupported faces explicitly without mutating locked geometry", async () => {
    const { api, host } = setup(
      Array.from({ length: 123 }, (_, faceIndex) => ({
        faceIndex,
        firstTriangle: faceIndex,
        triangleCount: 1,
        kind: "unsupported",
        surfaceType: 3,
      })),
    );
    try {
      const job = await settle(
        api,
        await api.invoke("alignment_references", {
          entityId: "cad",
          offset: 100,
          limit: 20,
        }),
      );
      expect(job.result).toMatchObject({
        total: 123,
        nextOffset: 120,
        offset: 100,
        units: "mm",
      });
      expect(job.result.references).toHaveLength(20);
      expect(job.result.references[0]).toMatchObject({
        id: "cad/face/100",
        kind: "unsupported",
        surfaceType: 3,
      });
      expect(host.commit).not.toHaveBeenCalled();
    } finally {
      api.dispose();
    }
  });
  it("returns fitted plane, cylinder, cone and sphere reference types", async () => {
    const { api, state } = setup();
    try {
      for (const [kind, expected] of [
        ["plane", ["plane"]],
        ["cylinder", ["direction"]],
        ["cone", ["direction", "point"]],
        ["sphere", ["point"]],
      ] as const) {
        state.entities = [
          {
            ...state.entities[0],
            kernelId: undefined,
            fit: {
              kind,
              center: [0, 0, 0],
              axis: [0, 0, 1],
              height: 8,
              radius: 3,
              topRadius: 1,
              rms: 0,
              maxError: 0,
            },
          },
        ];
        const job = await settle(
          api,
          await api.invoke("alignment_references", { entityId: "cad" }),
        );
        expect(job.status).toBe("succeeded");
        expect(
          job.result.references.map((value: { kind: string }) => value.kind),
        ).toEqual(expected);
      }
    } finally {
      api.dispose();
    }
  });
  it("retains fitted references alongside exact CAD faces", async () => {
    const { api, state } = setup([
      {
        faceIndex: 0,
        firstTriangle: 0,
        triangleCount: 1,
        kind: "unsupported",
        surfaceType: 3,
      },
    ]);
    state.entities = [
      {
        ...state.entities[0],
        fit: {
          kind: "sphere",
          center: [1, 2, 3],
          axis: [0, 0, 1],
          radius: 2,
          rms: 0,
          maxError: 0,
        },
      },
    ];
    try {
      const job = await settle(
        api,
        await api.invoke("alignment_references", { entityId: "cad" }),
      );
      expect(job.status).toBe("succeeded");
      expect(job.result.references).toMatchObject([
        { id: "cad/face/0", source: "cadFace", kind: "unsupported" },
        {
          id: "cad/fit/point",
          source: "fittedPrimitive",
          kind: "point",
          point: [1, 2, 3],
        },
      ]);
    } finally {
      api.dispose();
    }
  });
  it("rejects results after the source model changes", async () => {
    const { api, state, read, host } = setup();
    let finish!: (value: CadAlignmentInput[]) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    try {
      const receipt = await api.invoke("alignment_references", {
        entityId: "cad",
      });
      state.entities = [{ ...state.entities[0], kernelId: "replacement-body" }];
      finish([]);
      expect(await settle(api, receipt)).toMatchObject({
        status: "failed",
        error: { code: "REVISION_CONFLICT" },
      });
      expect(host.commit).not.toHaveBeenCalled();
    } finally {
      api.dispose();
    }
  });
  it("cancels an in-flight native read and discards its result", async () => {
    const { api, read, host } = setup();
    let finish!: (value: CadAlignmentInput[]) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    try {
      const receipt = await api.invoke("alignment_references", {
        entityId: "cad",
      });
      if (!receipt.ok) throw new Error(receipt.error.message);
      await api.invoke("job_cancel", {
        jobId: (receipt.result as { jobId: string }).jobId,
      });
      finish([]);
      expect(await settle(api, receipt)).toMatchObject({ status: "cancelled" });
      expect(host.commit).not.toHaveBeenCalled();
    } finally {
      api.dispose();
    }
  });
  it("tracks fitted reference metadata in workspace revisions", () => {
    const { api, state } = setup();
    try {
      expect(api.currentRevision()).toBe(0);
      state.entities = [
        {
          ...state.entities[0],
          fit: {
            kind: "sphere",
            center: [1, 2, 3],
            axis: [0, 0, 1],
            radius: 2,
            rms: 0,
            maxError: 0,
          },
        },
      ];
      expect(api.currentRevision()).toBe(1);
    } finally {
      api.dispose();
    }
  });
});
