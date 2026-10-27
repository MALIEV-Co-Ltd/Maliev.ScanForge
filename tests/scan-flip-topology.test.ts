import { validateProject } from "../src/io";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
} from "../src/project-file-codec";
import { indexedMeshMatches } from "../src/indexed-mesh";
import {
  flipSourceTopology,
  flipSourceTopologySync,
} from "../src/scan-flip-request";
import { Buffer } from "node:buffer";
import {
  estimatedPackedTopologyBytes,
  packTopology,
  packedTopologyBytes,
  unpackTopology,
} from "../src/topology-cache-codec";
import { appendMeshEdges, MeshEdgeIndex } from "../src/mesh-edge-index";
import { flippedTopology } from "../src/scan-flip-topology";
import noiseCapture from "./fixtures/noise-normal-kernel.json";
import { afterEach, expect, it, vi } from "vitest";
import {
  analyzeMesh,
  type MeshProcessingOptions,
} from "../src/mesh-processing";
import { flipScanNormals } from "../src/scan-tools-transforms";
import { runScanTool } from "../src/scan-tools";
import { noiseRings } from "../src/scan-noise-parallel";
import { smoothingRings } from "../src/scan-smoothing-kernel";
import capture from "./fixtures/flip-kernel-native.json";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";

const decode = (hex: string) =>
  new Float32Array(
    Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16)).buffer,
  );

it("lets cancellation interrupt large indexed Flip admission before worker dispatch", async () => {
  const vertices = new Float32Array(300_000);
  const triangles = new Uint32Array(300_000);
  const positions = new Float32Array(900_000);
  const source = { indexedMesh: { vertices, triangles }, positions };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 0);
  try {
    const result = await flipSourceTopology(source as never, () =>
      controller.signal.throwIfAborted(),
    ).then(
      () => "completed",
      () => "cancelled",
    );
    expect(result).toBe("cancelled");
  } finally {
    clearTimeout(timer);
  }
});

it("preserves the synchronous topology admission contract across invalid and sparse inputs", async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const valid = { vertices: Array.from(positions), triangles: [0, 1, 2] };
  const sparse = [0, 0, 0, 1, 0, 0, 0, 1, 0, , ,];
  const cases = [
    valid,
    { ...valid, triangles: [0, 2, 1] },
    { ...valid, triangles: [0, 1, 99] },
    { ...valid, vertices: [NaN, ...valid.vertices.slice(1)] },
    { ...valid, normals: new Array(9) },
    { ...valid, geometryNormals: new Array(9) },
    { ...valid, facetNormals: [0, 0, Infinity] },
    { ...valid, vertices: sparse },
  ];
  for (const indexedMesh of cases) {
    const source = { positions, indexedMesh } as never;
    expect(await flipSourceTopology(source)).toEqual(
      flipSourceTopologySync(source),
    );
  }
});
afterEach(() => vi.unstubAllGlobals());

it.each(capture.cases)(
  "retains native vertex identity after flipping $name",
  (entry) => {
    const positions = decode(entry.inputBits);
    const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
    const before = analyzeMesh(positions, {
      tolerance: 0.001,
      topologyCache: cache,
    });
    const originalTriangles = before.triangles.slice();
    const oldNoise = noiseRings(before),
      oldSmooth = smoothingRings(before);
    const stages: string[] = [];
    const flipped = flipScanNormals(positions, { topologyCache: cache });
    expect(new Uint8Array(flipped.positions.buffer)).toEqual(
      new Uint8Array(decode(entry.nativeBits).buffer),
    );
    const after = analyzeMesh(flipped.positions, {
      tolerance: 0.001,
      topologyCache: cache,
      onProgress: (_, stage) => stages.push(stage),
    });
    expect(stages).toEqual(["Reusing mesh topology"]);
    expect(after.vertices).toBe(before.vertices);
    for (const field of [
      "neighbors",
      "components",
      "boundaryLoops",
      "boundaryChains",
    ] as const)
      expect(after[field]).toBe(before[field]);
    expect(before.triangles).toEqual(originalTriangles);
    expect(after.triangles).not.toBe(before.triangles);
    for (const [key, uses] of after.edges)
      uses.forEach((use, i) => {
        expect(use.from).toBe(before.edges.get(key)![i].to);
        expect(use.to).toBe(before.edges.get(key)![i].from);
      });
    expect(noiseRings(after)).not.toBe(oldNoise);
    expect(smoothingRings(after)).not.toBe(oldSmooth);
    const restored = flipScanNormals(flipped.positions, {
      topologyCache: cache,
    });
    expect(new Uint8Array(restored.positions.buffer)).toEqual(
      new Uint8Array(positions.buffer),
    );
    const twice = analyzeMesh(restored.positions, {
      tolerance: 0.001,
      topologyCache: cache,
    });
    expect(twice.triangles).toEqual(before.triangles);
    expect([...twice.edges]).toEqual([...before.edges]);
  },
);

it("flips cached edges without enumerating the full source and serializes their order", () => {
  const positions = decode(capture.cases[0].inputBits);
  const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  const source = analyzeMesh(positions, { topologyCache: cache });
  const originalEdges = [...source.edges];
  const edges = source.edges;
  source.edges = new Proxy(edges, {
    get(target, property) {
      if (property === Symbol.iterator) throw new Error("full edge copy");
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const output = flipScanNormals(positions, { topologyCache: cache });
  const flipped = cache.topology!;
  const expected = originalEdges.map(([key, uses]) => [
    key,
    uses.map(({ face, from, to }) => ({ face, from: to, to: from })),
  ]);
  expect([...flipped.edges]).toEqual(expected);
  expect(flipped.edges.size).toBe(originalEdges.length);
  const restored = unpackTopology(
    packTopology(flipped),
    output.positions.length,
  )!;
  expect(restored).toBeDefined();
  expect([...restored.edges]).toEqual(expected);
  expect([...edges]).toEqual(originalEdges);
});

it("composes reversed and appended edge snapshots without changing order or old incidence", () => {
  const source = analyzeMesh(decode(capture.cases[0].inputBits));
  const reversed = flippedTopology(source);
  const original = [...source.edges],
    reversedSnapshot = [...reversed.edges];
  const extra = new Uint32Array([...reversed.triangles, 0, 1, 2]);
  const appended = appendMeshEdges(
    reversed.edges,
    extra,
    reversed.triangles.length,
  );
  const expected = new Map(reversed.edges);
  for (let i = reversed.triangles.length; i < extra.length; i++) {
    const from = extra[i],
      to = extra[i - (i % 3) + ((i + 1) % 3)];
    const key = from < to ? `${from}:${to}` : `${to}:${from}`;
    expected.set(key, [
      ...(expected.get(key) ?? []),
      { face: Math.floor(i / 3), from, to },
    ]);
  }
  expect([...appended]).toEqual([...expected]);
  const again = flippedTopology({
    ...reversed,
    triangles: extra,
    edges: appended,
  });
  expect([...again.edges]).toEqual(
    [...expected].map(([key, uses]) => [
      key,
      uses.map(({ face, from, to }) => ({ face, from: to, to: from })),
    ]),
  );
  expect([...reversed.edges]).toEqual(reversedSnapshot);
  expect([...source.edges]).toEqual(original);
  const calls: unknown[] = [];
  again.edges.forEach((uses, key, map) =>
    calls.push([key, uses, map === again.edges]),
  );
  expect(calls).toEqual(
    [...again.edges].map(([key, uses]) => [key, uses, true]),
  );
});

it("keeps repeated flip and append compositions bounded", () => {
  let topology = analyzeMesh(decode(capture.cases[0].inputBits));
  const expected = [...topology.edges];
  for (let i = 0; i < 3000; i++) {
    topology = flippedTopology(topology);
    topology = {
      ...topology,
      edges: appendMeshEdges(
        topology.edges,
        topology.triangles,
        topology.triangles.length,
      ),
    };
  }
  expect([...topology.edges]).toEqual(expected);
});

it("preserves incidence through repeated nonempty flip and append edits", () => {
  let topology = analyzeMesh(decode(capture.cases[0].inputBits));
  let reference = new Map(topology.edges);
  const original = [...topology.edges];
  for (let n = 0; n < 200; n++) {
    topology = flippedTopology(topology);
    reference = new Map(
      [...reference].map(([key, uses]) => [
        key,
        uses.map(({ face, from, to }) => ({ face, from: to, to: from })),
      ]),
    );
    const start = topology.triangles.length;
    const triangles = new Uint32Array([...topology.triangles, 0, 1, 2]);
    for (let k = 0; k < 3; k++) {
      const from = triangles[start + k],
        to = triangles[start + ((k + 1) % 3)];
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      reference.set(key, [
        ...(reference.get(key) ?? []),
        { face: start / 3, from, to },
      ]);
    }
    topology = {
      ...topology,
      triangles,
      edges: appendMeshEdges(topology.edges, triangles, start),
    };
  }
  expect([...topology.edges]).toEqual([...reference]);
  expect(original.length).toBeGreaterThan(0);
});

it("packs flipped compact edges using the compact index", () => {
  const topology = analyzeMesh(decode(capture.cases[0].inputBits));
  expect(topology.edges).toBeInstanceOf(MeshEdgeIndex);
  const pack = vi.spyOn(topology.edges as MeshEdgeIndex, "packCorners");
  const flipped = flippedTopology(topology);
  const packed = packTopology(flipped);
  expect(estimatedPackedTopologyBytes(flipped)).toBe(
    packedTopologyBytes(packed),
  );
  const restored = unpackTopology(packed, flipped.triangles.length * 3)!;
  expect(pack).toHaveBeenCalledOnce();
  expect([...restored.edges]).toEqual([...flipped.edges]);
});

it("does not publish a changed cache on cancellation or progress callback failure", () => {
  const positions = decode(capture.cases[0].inputBits);
  const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  const topology = analyzeMesh(positions, { topologyCache: cache });
  const controller = new AbortController();
  expect(() =>
    flipScanNormals(positions, {
      topologyCache: cache,
      signal: controller.signal,
      onProgress: (_, stage) => {
        if (stage === "Updating mesh winding") controller.abort();
      },
    }),
  ).toThrow(/cancelled/);
  expect(cache.positions).toBe(positions);
  expect(cache.topology).toBe(topology);
  expect(() =>
    flipScanNormals(positions, {
      topologyCache: cache,
      onProgress: (_, stage) => {
        if (stage === "Complete") throw new Error("Progress failed");
      },
    }),
  ).toThrow("Progress failed");
  expect(cache.positions).toBe(positions);
  expect(cache.topology).toBe(topology);
});

it("does not weld cold geometry or replace a cache belonging to another source", () => {
  const positions = decode(capture.cases[0].inputBits);
  const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  runScanTool(
    { kind: "scanTools", positions, operation: { kind: "flipNormals" } },
    { topologyCache: cache },
  );
  expect(cache).toEqual({});
  const topology = analyzeMesh(positions, { topologyCache: cache });
  flipScanNormals(positions.slice(), { topologyCache: cache });
  expect(cache.positions).toBe(positions);
  expect(cache.topology).toBe(topology);
});

it("preserves welded representatives even when reversing corners changes first-seen coordinates", () => {
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 1.0005, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0,
  ]);
  const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  const before = analyzeMesh(positions, {
    tolerance: 0.001,
    topologyCache: cache,
  });
  const result = flipScanNormals(positions, { topologyCache: cache });
  const retained = analyzeMesh(result.positions, {
    tolerance: 0.001,
    topologyCache: cache,
  });
  const rebuilt = analyzeMesh(result.positions, { tolerance: 0.001 });
  expect(retained.vertices).toBe(before.vertices);
  expect(retained.degenerateTriangles).toBe(1);
  expect(Array.from(rebuilt.vertices)).not.toEqual(
    Array.from(retained.vertices),
  );
  expect(Array.from(before.vertices)).toContain(1);
  expect(Array.from(rebuilt.vertices)).toContain(positions[6]);
});

it("production worker retains canonical flipped topology across transferred results and reports", async () => {
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      | ((event: {
          data: ProcessingRequest & { geometryKey: number };
        }) => Promise<void>)
      | null,
    postMessage: (data: ProcessingResponse, transfers?: Transferable[]) =>
      replies.push(structuredClone(data, { transfer: transfers ?? [] })),
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("../src/processing-worker");
  for (const [index, entry] of capture.cases.entries()) {
    await scope.onmessage!({
      data: {
        kind: "report",
        positions: decode(entry.inputBits),
        tolerance: 0.001,
        geometryKey: index + 1,
      },
    });
    const before = replies.at(-1)!;
    expect("result" in before).toBe(true);
    replies.length = 0;
    await scope.onmessage!({
      data: {
        kind: "scanTools",
        positions: new Float32Array(),
        operation: { kind: "flipNormals" },
        geometryKey: index + 1,
      },
    });
    const flipped = replies.at(-1)!;
    if (!("result" in flipped) || !flipped.result.positions)
      throw new Error("Expected flipped worker output");
    expect(new Uint8Array(flipped.result.positions.buffer)).toEqual(
      new Uint8Array(decode(entry.nativeBits).buffer),
    );
    replies.length = 0;
    await scope.onmessage!({
      data: {
        kind: "report",
        positions: new Float32Array(),
        tolerance: 0.001,
        geometryKey: index + 1,
      },
    });
    const stages = replies.flatMap((reply) =>
      "progress" in reply ? [reply.stage] : [],
    );
    expect(stages).toEqual(["Reusing mesh topology"]);
    const after = replies.at(-1)!;
    if (!("result" in before) || !("result" in after))
      throw new Error("Expected topology reports");
    expect(before.result.topology?.triangles).toBe(entry.inputBits.length / 72);
    expect(after.result.topology).toEqual(before.result.topology);
  }
});

it("returns indexed successor normals from the production worker without detaching source data", async () => {
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      null | ((event: { data: ProcessingRequest }) => Promise<void>),
    postMessage: (data: ProcessingResponse, transfers?: Transferable[]) =>
      replies.push(structuredClone(data, { transfer: transfers ?? [] })),
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("../src/processing-worker");
  const source = new Float32Array([
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0,
  ]);
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const triangles = new Uint32Array([0, 1, 2, 0, 2, 3]);
  await scope.onmessage!({
    data: structuredClone({
      kind: "scanTools" as const,
      positions: source,
      operation: {
        kind: "flipNormals" as const,
        sourceTopology: { vertices, triangles },
      },
    }),
  });
  const reply = replies.at(-1)!;
  if (!("result" in reply) || !reply.result.indexedMesh)
    throw new Error("Expected indexed output");
  expect(Array.from(reply.result.indexedMesh.triangles)).toEqual([
    0, 2, 1, 0, 3, 2,
  ]);
  expect(Array.from(reply.result.indexedMesh.geometryNormals!)).toEqual([
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
  ]);
  expect(Array.from(triangles)).toEqual([0, 1, 2, 0, 2, 3]);
  expect(vertices.length).toBe(12);
});

it("inverts retained facet-normal bits and uses them for vertex refresh", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const triangles = new Uint32Array([0, 1, 2]);
  const facetNormals = new Float32Array([0, 1, -0]);
  const beforeBits = Array.from(new Uint32Array(facetNormals.buffer));
  const output = flipScanNormals(vertices, {
    sourceTopology: { vertices, triangles, facetNormals },
  });
  expect(output.indexedMesh).toBeDefined();
  const result = output.indexedMesh!;
  expect(
    Array.from(new Uint32Array((result.facetNormals as Float32Array).buffer)),
  ).toEqual(beforeBits.map((bits) => (bits ^ 0x80000000) >>> 0));
  expect(Array.from(result.geometryNormals!)).toEqual([
    0, -1, 0, 0, -1, 0, 0, -1, 0,
  ]);
  expect(Array.from(new Uint32Array(facetNormals.buffer))).toEqual(beforeBits);
});

it("rejects non-finite refreshed normals atomically for extreme indexed coordinates", () => {
  const vertices = new Float32Array([-3e38, 0, 0, 3e38, 0, 0, 0, 1, 0]);
  const triangles = new Uint32Array([0, 1, 2]);
  const before = vertices.slice();
  expect(() =>
    flipScanNormals(vertices, { sourceTopology: { vertices, triangles } }),
  ).toThrow(/finite vertex normals/i);
  expect(vertices).toEqual(before);
  expect(Array.from(triangles)).toEqual([0, 1, 2]);
});

it("matches captured native reversed-triangle vertex normals when facet state is absent", () => {
  const native = noiseCapture.cases.find(
    (entry) => entry.label === "reversed-triangle",
  )!;
  const vertices = Float32Array.from(native.vertices);
  const output = flipScanNormals(vertices, {
    sourceTopology: { vertices, triangles: new Uint32Array([0, 1, 2]) },
  });
  const normals = output.indexedMesh!.geometryNormals as Float32Array;
  expect(
    Buffer.from(
      normals.buffer,
      normals.byteOffset,
      normals.byteLength,
    ).toString("hex"),
  ).toBe(native.nativeNormalBits);
});

it("reports monotonic progress when flipping an indexed scan with a warm topology cache", () => {
  const source = decode(capture.cases[0].inputBits);
  const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  const topology = analyzeMesh(source, {
    tolerance: 0.001,
    topologyCache: cache,
  });
  const indexed = {
    vertices: Float32Array.from(topology.vertices),
    triangles: topology.triangles,
  };
  const progress: number[] = [];
  flipScanNormals(source, {
    topologyCache: cache,
    sourceTopology: indexed,
    onProgress: (value) => progress.push(value),
  });
  expect(progress.length).toBeGreaterThan(1);
  expect(progress.at(-1)).toBe(1);
  expect(
    progress.every((value, i) => i === 0 || value >= progress[i - 1]),
  ).toBe(true);
});

it("retains the index when ordinary source coordinates require Float32 rounding", () => {
  const vertices = [0.1, 0, 0, 1, 0, 0, 0, 1, 0];
  const triangles = [0, 1, 2];
  const output = flipScanNormals(vertices, {
    sourceTopology: { vertices, triangles },
  });
  expect(indexedMeshMatches(output.indexedMesh, output.positions)).toBe(true);
  expect(output.indexedMesh!.vertices[0]).toBe(Math.fround(0.1));
  expect(vertices[0]).toBe(0.1);
});

it("retains rounded indexed Flip Normals state through binary project reopening", async () => {
  const vertices = [0.1, 0, 0, 1, 0, 0, 0, 1, 0];
  const triangles = [0, 1, 2];
  const output = flipScanNormals(vertices, {
    sourceTopology: { vertices, triangles },
  });
  const project = validateProject({
    format: "maliev-scanforge",
    version: 1,
    units: "mm",
    name: "Flip",
    entities: [
      {
        id: "mesh",
        name: "Scan",
        kind: "mesh",
        positions: output.positions,
        indexedMesh: output.indexedMesh,
        color: "#ffffff",
        visible: true,
        opacity: 1,
      },
    ],
  });
  const file = await encodeProjectFileLocally({
    project,
    history: [],
    future: [],
  });
  const reopened = await decodeProjectContents(file);
  const mesh = reopened.project.entities[0];
  expect(indexedMeshMatches(mesh.indexedMesh, mesh.positions)).toBe(true);
  expect(Array.from(mesh.indexedMesh!.triangles)).toEqual([0, 2, 1]);
  expect(Array.from(mesh.indexedMesh!.geometryNormals!)).toEqual([
    0, 0, -1, 0, 0, -1, 0, 0, -1,
  ]);
});

it("preserves distinct signed-zero corner and indexed vertex bits through flip and binary reopen", async () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const positions = vertices.slice();
  positions[0] = -0;
  const output = flipScanNormals(positions, {
    sourceTopology: { vertices, triangles: new Uint32Array([0, 1, 2]) },
  });
  expect(Object.is(output.positions[0], -0)).toBe(true);
  expect(Object.is(output.indexedMesh!.vertices[0], 0)).toBe(true);
  const project = validateProject({
    format: "maliev-scanforge",
    version: 1,
    units: "mm",
    name: "Zeros",
    entities: [
      {
        id: "mesh",
        name: "Scan",
        kind: "mesh",
        positions: output.positions,
        indexedMesh: output.indexedMesh,
        color: "#ffffff",
        visible: true,
        opacity: 1,
      },
    ],
  });
  const reopened = await decodeProjectContents(
    await encodeProjectFileLocally({ project, history: [], future: [] }),
  );
  expect(Object.is(reopened.project.entities[0].positions[0], -0)).toBe(true);
  expect(
    Object.is(reopened.project.entities[0].indexedMesh!.vertices[0], 0),
  ).toBe(true);
});

it.each(noiseCapture.cases.filter((entry) => entry.triangles.length > 0))(
  "matches captured normal refresh after indexed flip: $label",
  (entry) => {
    const vertices = Float32Array.from(entry.vertices);
    const triangles = Uint32Array.from(entry.triangles);
    for (let i = 0; i < triangles.length; i += 3)
      [triangles[i + 1], triangles[i + 2]] = [
        triangles[i + 2],
        triangles[i + 1],
      ];
    const positions = Float32Array.from(
      Array.from(triangles).flatMap((id) =>
        Array.from(vertices.slice(id * 3, id * 3 + 3)),
      ),
    );
    const result = flipScanNormals(positions, {
      sourceTopology: { vertices, triangles },
    });
    const normals = result.indexedMesh!.geometryNormals as Float32Array;
    expect(
      Buffer.from(
        normals.buffer,
        normals.byteOffset,
        normals.byteLength,
      ).toString("hex"),
    ).toBe(entry.nativeNormalBits);
  },
);

it.each(["Preparing facet normals", "Refreshing vertex normals"])(
  "cancels indexed Flip during %s without publishing a partial cache",
  (cancelStage) => {
    const positions = decode(capture.cases[0].inputBits);
    const before = positions.slice();
    const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
    const topology = analyzeMesh(positions, {
      tolerance: 0.001,
      topologyCache: cache,
    });
    const vertices = Float32Array.from(topology.vertices);
    const triangles = topology.triangles.slice();
    const sourceVertices = vertices.slice();
    const sourceTriangles = triangles.slice();
    const controller = new AbortController();
    expect(() =>
      flipScanNormals(positions, {
        topologyCache: cache,
        sourceTopology: { vertices, triangles },
        signal: controller.signal,
        onProgress: (_, stage) => {
          if (stage === cancelStage) controller.abort();
        },
      }),
    ).toThrow(/cancelled|aborted/i);
    expect(positions).toEqual(before);
    expect(vertices).toEqual(sourceVertices);
    expect(triangles).toEqual(sourceTriangles);
    expect(cache.positions).toBe(positions);
    expect(cache.topology).toBe(topology);
  },
);
