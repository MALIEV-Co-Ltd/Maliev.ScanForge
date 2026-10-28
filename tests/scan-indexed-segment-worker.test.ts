import { expect, it, vi } from "vitest";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";
import { runFiniteSplitCandidate } from "../src/scan-split-finite-candidate";
import { indexedMeshMatches } from "../src/indexed-mesh";
import { runScanEdit } from "../src/scan-edit";
import { smoothDisplayNormals } from "../src/viewport-display";

it("runs exact indexed component inventory in the worker without expanded positions", async () => {
  vi.resetModules();
  const replies: ProcessingResponse[] = [];
  let transferredInventory = false;
  const scope = {
    onmessage: null as
      null | ((event: { data: ProcessingRequest }) => Promise<void>),
    postMessage(message: ProcessingResponse, transfer: Transferable[] = []) {
      if ("result" in message) {
        const triangles =
          message.result.scanEdit?.inventory?.components[0]?.triangles;
        transferredInventory =
          triangles instanceof Uint32Array &&
          transfer.includes(triangles.buffer);
      }
      replies.push(structuredClone(message, { transfer }));
    },
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0, 4, 0, 0, 6, 0, 0, 4, 2, 0];
    const triangles = new Uint32Array([0, 1, 2, 3, 4, 5]);
    const expected = runScanEdit({
      kind: "scanEdit",
      action: "inventory",
      inventoryScope: "components",
      positions: vertices,
      sourceIndexed: { vertices, triangles },
    });
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "inventory",
        inventoryScope: "components",
        positions: new Float32Array(),
        sourceIndexed: { vertices, triangles },
        packedScanEditSource: { indexedInventory: true },
      } as ProcessingRequest,
    });
    const reply = replies.at(-1);
    if (!reply || !("result" in reply)) throw Error(JSON.stringify(reply));
    expect(transferredInventory).toBe(true);
    const inventory = reply.result.scanEdit!.inventory!;
    expect(inventory.components[0].triangles).toBeInstanceOf(Uint32Array);
    expect({
      ...inventory,
      components: inventory.components.map((component) => ({
        ...component,
        triangles: Array.from(component.triangles),
      })),
    }).toEqual(expected.inventory);
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "inventory",
        positions: new Float32Array(),
        sourceIndexed: { vertices, triangles },
        packedScanEditSource: { indexedInventory: true },
      } as ProcessingRequest,
    });
    expect(replies.at(-1)).toMatchObject({
      error: expect.stringMatching(/invalid indexed component inventory/i),
    });
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});

it("prepares equivalent indexed display normals for a precise Extract worker result", async () => {
  vi.resetModules();
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      null | ((event: { data: ProcessingRequest }) => Promise<void>),
    postMessage(message: ProcessingResponse, transfer: Transferable[] = []) {
      replies.push(structuredClone(message, { transfer }));
    },
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1];
    const triangles = new Uint32Array([0, 1, 2, 1, 3, 2]);
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "componentExtract",
        indices: [0],
        positions: new Float32Array(),
        sourceIndexed: { vertices, triangles },
        packedScanEditSource: { indexedExtract: true },
      } as ProcessingRequest,
    });
    const reply = replies.at(-1);
    if (!reply || !("result" in reply) || !reply.packedScanSegments)
      throw Error(JSON.stringify(reply));
    const packed = reply.packedScanSegments[0];
    const mesh = reply.result.scanEdit!.segmentIndexedMeshes![0]!;
    const render = reply.result.segmentRenderData![0];
    expect(render.indexedMesh).toBe(mesh);
    const expanded = smoothDisplayNormals(packed.positions);
    for (let slot = 0; slot < mesh.triangles.length; slot++)
      for (let axis = 0; axis < 3; axis++)
        expect(render.normals![mesh.triangles[slot] * 3 + axis]).toBe(
          expanded[slot * 3 + axis],
        );
    const progress = replies
      .filter((reply) => "progress" in reply)
      .map((reply) => (reply as { progress: number }).progress);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});

function receive(
  message: ProcessingResponse,
  transfer: Transferable[],
): ProcessingResponse {
  const clone = structuredClone(message, { transfer });
  if ("result" in clone && clone.packedScanEdit) {
    clone.result.scanEdit!.positions = Array.from(
      clone.packedScanEdit.positions,
    );
    clone.result.indexedMesh!.vertices = Array.from(
      clone.packedScanEdit.vertices,
    );
    delete clone.packedScanEdit;
  }
  return clone;
}

it("transfers precise Split coordinates while retaining the persistent successor", async () => {
  vi.resetModules();
  const replies: ProcessingResponse[] = [];
  let transferred = false;
  const scope = {
    onmessage: null as
      null | ((event: { data: ProcessingRequest }) => Promise<void>),
    postMessage(message: ProcessingResponse, transfer: Transferable[] = []) {
      if ("result" in message) {
        const packed = (
          message as unknown as {
            packedScanEdit?: {
              positions: Float64Array;
              vertices: Float64Array;
            };
          }
        ).packedScanEdit;
        if (packed)
          transferred =
            transfer.includes(packed.positions.buffer) &&
            transfer.includes(packed.vertices.buffer);
      }
      replies.push(structuredClone(message, { transfer }));
    },
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    const source = new Float32Array([
      100000000, 0, 0, 100000008, 8, 0, 99999992, 16, 0,
    ]);
    const target = [
      100000004, -100, -10, 100000004, 100, -10, 100000004, 0, 100,
    ];
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "split",
        positions: source,
        target,
        geometryKey: 99,
      } as ProcessingRequest,
    });
    const reply = replies.find((entry) => "result" in entry);
    if (!reply || !("result" in reply)) throw Error(JSON.stringify(reply));
    const packed = (
      reply as unknown as {
        packedScanEdit?: { positions: Float64Array; vertices: Float64Array };
      }
    ).packedScanEdit;
    expect(packed?.positions).toBeInstanceOf(Float64Array);
    expect(packed?.vertices).toBeInstanceOf(Float64Array);
    expect(transferred).toBe(true);
    expect(Array.from(packed!.positions)).toContain(100000004);
    expect(reply.result.scanEdit?.positions).toBeUndefined();
    replies.length = 0;
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "inventory",
        positions: new Float32Array(),
        geometryKey: 99,
      } as ProcessingRequest,
    });
    const inventory = replies.find((entry) => "result" in entry);
    if (!inventory || !("result" in inventory))
      throw Error(JSON.stringify(inventory));
    const components = inventory.result.scanEdit?.inventory?.components;
    expect(components).toBeDefined();
    expect(
      components!.reduce(
        (sum, component) => sum + component.triangles.length,
        0,
      ),
    ).toBe(packed!.positions.length / 9);
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});

it("retains the original persistent source if packed Split publication fails", async () => {
  vi.resetModules();
  const replies: ProcessingResponse[] = [];
  let rejectResult = true;
  const scope = {
    onmessage: null as
      null | ((event: { data: ProcessingRequest }) => Promise<void>),
    postMessage(message: ProcessingResponse, transfer: Transferable[] = []) {
      if ("result" in message && rejectResult) {
        rejectResult = false;
        throw Error("injected publication failure");
      }
      replies.push(structuredClone(message, { transfer }));
    },
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "split",
        positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
        target: new Float32Array([1, -2, -1, 1, 4, -1, 1, -2, 3]),
        geometryKey: 77,
      } as ProcessingRequest,
    });
    expect(
      replies.some((entry) => "error" in entry && /injected/.test(entry.error)),
    ).toBe(true);
    replies.length = 0;
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "inventory",
        positions: new Float32Array(),
        geometryKey: 77,
      } as ProcessingRequest,
    });
    const response = replies.find((entry) => "result" in entry);
    if (!response || !("result" in response))
      throw Error(JSON.stringify(response));
    const components = response.result.scanEdit?.inventory?.components;
    expect(
      components!.reduce(
        (sum, component) => sum + component.triangles.length,
        0,
      ),
    ).toBe(1);
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});

it("executes the finite-cutter route in the real worker dispatcher", async () => {
  vi.resetModules();
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      null | ((event: { data: ProcessingRequest }) => Promise<void>),
    postMessage(message: ProcessingResponse, transfer: Transferable[] = []) {
      replies.push(receive(message, transfer));
    },
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "split",
        positions,
        sourceIndexed: {
          vertices: positions.slice(),
          triangles: new Uint32Array([0, 1, 2]),
        },
        target: new Float32Array([1, -2, -1, 1, 4, -1, 1, -2, 3]),
      },
    });
    const reply = replies.at(-1);
    if (!reply || !("result" in reply)) throw Error(JSON.stringify(reply));
    expect(reply.result.scanEdit?.segments).toBeUndefined();
    expect(
      indexedMeshMatches(
        reply.result.indexedMesh,
        reply.result.scanEdit!.positions!,
      ),
    ).toBe(true);
    expect(reply.result.scanEdit!.diagnostics.parts).toBe(2);
    expect(reply.result.renderData?.indexedMesh).toBe(reply.result.indexedMesh);
    expect(reply.result.renderData?.normals).toHaveLength(
      reply.result.indexedMesh!.vertices.length,
    );
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});

it("transports a precise single-mesh split and its indexed topology", async () => {
  vi.resetModules();
  vi.doMock("../src/scan-edit", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/scan-edit")>();
    return {
      ...actual,
      runScanEditAsync: async (request: {
        positions: Float32Array;
        target: Float32Array;
      }) => {
        const candidate = runFiniteSplitCandidate(
          request.positions,
          request.target,
          undefined,
          { preciseCoordinates: true, outputMode: "single-mesh" },
        );
        return {
          positions: candidate.mesh.positions,
          indexedMesh: candidate.mesh.indexedMesh,
          diagnostics: candidate.diagnostics,
        };
      },
    };
  });
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      null | ((event: { data: ProcessingRequest }) => Promise<void>),
    postMessage(message: ProcessingResponse, transfer: Transferable[] = []) {
      replies.push(receive(message, transfer));
    },
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "split",
        positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
        target: new Float32Array([1, -2, -1, 1, 4, -1, 1, -2, 3]),
      },
    });
    const reply = replies.at(-1);
    if (!reply || !("result" in reply)) throw Error(JSON.stringify(reply));
    expect(Array.isArray(reply.result.scanEdit?.positions)).toBe(true);
    expect(
      indexedMeshMatches(
        reply.result.indexedMesh,
        reply.result.scanEdit!.positions!,
      ),
    ).toBe(true);
  } finally {
    vi.doUnmock("../src/scan-edit");
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});

it.each([false, true])(
  "dispatches indexed segment buffers (precise=%s)",
  async (precise) => {
    vi.resetModules();
    vi.doMock("../src/scan-edit", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/scan-edit")>();
      return {
        ...actual,
        runScanEditAsync: async () => {
          const positions = precise
            ? [100000000, 0, 0, 100000004, 4, 0, 99999992, 16, 0]
            : new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
          return {
            positions: undefined,
            segments: [positions],
            segmentIndexedMeshes: [
              { vertices: positions, triangles: new Uint32Array([0, 1, 2]) },
            ],
            diagnostics: {},
          };
        },
      };
    });
    const replies: ProcessingResponse[] = [];
    const scope = {
      onmessage: null as
        null | ((event: { data: ProcessingRequest }) => Promise<void>),
      postMessage(message: ProcessingResponse, transfer: Transferable[] = []) {
        expect(transfer.every((buffer) => buffer instanceof ArrayBuffer)).toBe(
          true,
        );
        expect(new Set(transfer).size).toBe(transfer.length);
        replies.push(structuredClone(message, { transfer }));
      },
    };
    vi.stubGlobal("self", scope);
    try {
      await import("../src/processing-worker");
      await scope.onmessage!({
        data: {
          kind: "scanEdit",
          action: "split",
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          plane: { origin: [0, 0, 0], normal: [0, 0, 1] },
        },
      });
      const reply = replies.at(-1);
      if (!reply || !("result" in reply)) throw Error(JSON.stringify(reply));
      const edit = reply.result.scanEdit!;
      expect(edit.segmentIndexedMeshes![0]!.vertices).toEqual(
        edit.segments![0],
      );
      expect(edit.segmentIndexedMeshes![0]!.triangles).toEqual(
        new Uint32Array([0, 1, 2]),
      );
      if (precise) {
        expect(edit.segments![0][3]).toBe(100000004);
        expect(edit.segmentIndexedMeshes![0]!.vertices).toBe(edit.segments![0]);
      } else
        expect(
          (edit.segmentIndexedMeshes![0]!.vertices as Float32Array).buffer,
        ).toBe((edit.segments![0] as Float32Array).buffer);
    } finally {
      vi.doUnmock("../src/scan-edit");
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  },
);

it("dispatches an actual precise finite candidate through the worker boundary", async () => {
  vi.resetModules();
  vi.doMock("../src/scan-edit", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/scan-edit")>();
    return {
      ...actual,
      runScanEditAsync: async (request: {
        positions: Float32Array;
        target: Float32Array;
      }) =>
        runFiniteSplitCandidate(request.positions, request.target, undefined, {
          preciseCoordinates: true,
        }),
    };
  });
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      null | ((event: { data: ProcessingRequest }) => Promise<void>),
    postMessage(message: ProcessingResponse, transfer: Transferable[] = []) {
      replies.push(structuredClone(message, { transfer }));
    },
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "split",
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        target: new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]),
      },
    });
    const reply = replies.at(-1);
    if (!reply || !("result" in reply)) throw Error(JSON.stringify(reply));
    const edit = reply.result.scanEdit!;
    expect(edit.segments).toHaveLength(1);
    expect(Array.isArray(edit.segments![0])).toBe(true);
    expect(
      indexedMeshMatches(edit.segmentIndexedMeshes![0], edit.segments![0]),
    ).toBe(true);
  } finally {
    vi.doUnmock("../src/scan-edit");
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
