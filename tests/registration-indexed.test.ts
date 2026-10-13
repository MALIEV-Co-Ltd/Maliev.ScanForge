import { afterEach, expect, it, vi } from "vitest";
import { expandPlyTopology } from "../src/ply-topology";
import { indexedMeshMatches } from "../src/indexed-mesh";
import {
  processMesh,
  type ProcessingRequest,
  type ProcessingResponse,
} from "../src/processing-client";
import { registerNativeLandmarks } from "../src/native-landmark-registration";
import captures from "./fixtures/alignment-registration-native.json";
import inputs from "./fixtures/alignment-npoints-native.json";
import {
  beginLandmarkAlignment,
  pickLandmark,
  landmarkRequest,
  acceptLandmarkAlignment,
} from "../src/landmark-alignment";
import type { Entity, Vec3 } from "../src/types";
afterEach(() => vi.unstubAllGlobals());
const accepted = captures.cases.filter(
  (c) =>
    c.accepted &&
    inputs.cases.find((i) => i.name === c.name)!.source.length >= 3,
);
it("rejects stale indexed geometry before producing an alignment result", async () => {
  const sourceIndexed = {
    vertices: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
    triangles: new Uint32Array([0, 1, 2]),
  };
  const positions = expandPlyTopology(sourceIndexed);
  positions[0] = 1;
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as unknown as (e: {
      data: ProcessingRequest;
    }) => Promise<void>,
    postMessage: (m: ProcessingResponse) => replies.push(m),
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("../src/processing-worker");
  await scope.onmessage({
    data: {
      kind: "paired",
      positions,
      sourceIndexed,
      sourceLandmarks: [0, 0, 0, 10, 0, 0, 0, 10, 0],
      targetLandmarks: [0, 0, 0, 10, 0, 0, 0, 10, 0],
    },
  });
  expect(replies.at(-1)).toMatchObject({
    error: "Alignment indexed topology does not match its render geometry.",
  });
  expect(replies.some((message) => "result" in message)).toBe(false);
});
it.each(accepted)(
  "retains topology through the real paired worker: $name",
  async (capture) => {
    const input = inputs.cases.find((i) => i.name === capture.name)!;
    const sourceIndexed = {
      vertices: new Float32Array([91, 82, 73, ...input.source.flat()]),
      triangles: new Uint32Array([1, 2, 3]),
    };
    const positions = expandPlyTopology(sourceIndexed);
    const moving: Entity = {
      id: "moving",
      name: "Moving",
      kind: "mesh",
      positions,
      indexedMesh: sourceIndexed,
      color: "#ffffff",
      opacity: 1,
      visible: true,
    };
    const fixed: Entity = {
      ...moving,
      id: "fixed",
      indexedMesh: undefined,
      positions: input.target.flat(),
    };
    let session = beginLandmarkAlignment(moving, fixed);
    for (let i = 0; i < input.source.length; i++) {
      session = pickLandmark(session, moving.id, input.source[i] as Vec3);
      session = pickLandmark(session, fixed.id, input.target[i] as Vec3);
    }
    const replies: ProcessingResponse[] = [];
    const scope = {
      onmessage: null as unknown as (e: {
        data: ProcessingRequest;
      }) => Promise<void>,
      postMessage: (m: ProcessingResponse) => replies.push(m),
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("../src/processing-worker");
    await scope.onmessage({
      data: landmarkRequest(session),
    });
    const reply = replies.at(-1)!;
    expect("result" in reply).toBe(true);
    if (!("result" in reply)) throw Error(JSON.stringify(reply));
    expect(reply.result.registration!.transform).toEqual(
      registerNativeLandmarks(input.source.flat(), input.target.flat())
        .transform,
    );
    expect(
      indexedMeshMatches(reply.result.indexedMesh, reply.result.positions!),
    ).toBe(true);
    expect(reply.result.indexedMesh!.triangles).toEqual(
      sourceIndexed.triangles,
    );
    expect(reply.result.indexedMesh!.vertices.length).toBe(
      sourceIndexed.vertices.length,
    );
    expect(sourceIndexed.vertices[0]).toBe(91);
    const committed = acceptLandmarkAlignment(
      { ...session, preview: reply.result },
      [moving, fixed],
    );
    expect(
      indexedMeshMatches(committed[0].indexedMesh, committed[0].positions),
    ).toBe(true);
    expect(committed[1]).toBe(fixed);
  },
);
it("clones registration metadata and releases cancellation without detaching source topology", async () => {
  const sourceIndexed = {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    triangles: new Uint32Array([0, 1, 2]),
  };
  let sent: ProcessingRequest | undefined;
  let stopped = false;
  vi.stubGlobal(
    "Worker",
    class {
      postMessage(value: ProcessingRequest) {
        sent = value;
      }
      terminate() {
        stopped = true;
      }
    },
  );
  const signal = new AbortController();
  const promise = processMesh(
    {
      kind: "paired",
      positions: expandPlyTopology(sourceIndexed),
      sourceIndexed,
      sourceLandmarks: [0, 0, 0, 3, 0, 0, 0, 3, 0],
      targetLandmarks: [0, 0, 0, 3, 0, 0, 0, 3, 0],
    },
    { signal: signal.signal },
  );
  expect(
    (sent as Extract<ProcessingRequest, { kind: "paired" }>).sourceIndexed!
      .vertices,
  ).not.toBe(sourceIndexed.vertices);
  signal.abort();
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  expect(stopped).toBe(true);
  expect(sourceIndexed.vertices.byteLength).toBe(36);
});
