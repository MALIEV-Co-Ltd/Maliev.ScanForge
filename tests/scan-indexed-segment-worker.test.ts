import { expect, it, vi } from "vitest";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";
import { runFiniteSplitCandidate } from "../src/scan-split-finite-candidate";
import { indexedMeshMatches } from "../src/indexed-mesh";

it("executes the finite-cutter route in the real worker dispatcher", async () => {
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
