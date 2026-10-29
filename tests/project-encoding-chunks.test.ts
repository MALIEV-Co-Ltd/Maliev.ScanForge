import { expect, it } from "vitest";
import {
  projectEncodingChunkSources,
  validateEncodingChunkSources,
  resolveEncodingChunkTokens,
} from "../src/project-encoding-chunks";
import { projectEncodingSnapshot } from "../src/project-encoding-snapshot";
import type { ProjectSession } from "../src/project-file-codec";

const hash = "a".repeat(64);
const shared = () => new Float32Array(new SharedArrayBuffer(12));
const session = (values: Float32Array[]): ProjectSession => ({
  project: {
    format: "maliev-scanforge",
    version: 1,
    units: "mm",
    name: "tokens",
    entities: values.map((positions, i) => ({
      id: String(i),
      name: String(i),
      kind: "pointcloud",
      positions,
      color: "#aaaaaa",
      visible: true,
      opacity: 1,
    })),
  },
  history: [],
  future: [],
});

it("bounds original sources at 128, keeps aliases once and visits history/future", () => {
  const values = Array.from({ length: 129 }, shared),
    source = session(values.slice(0, 1));
  source.history = [
    {
      label: "old",
      entities: session([values[0], ...values.slice(1, 64)]).project.entities,
    },
  ];
  source.future = [
    { label: "next", entities: session(values.slice(64)).project.entities },
  ];
  const sources = projectEncodingChunkSources(projectEncodingSnapshot(source));
  expect(sources).toHaveLength(128);
  expect(sources[0]).toBe(values[0].buffer);
  expect(sources[127]).toBe(values[127].buffer);
});

it("captures only full shared-view metadata, deferring finite validation to the worker", () => {
  const invalid = shared();
  invalid[0] = NaN;
  expect(
    projectEncodingChunkSources(
      projectEncodingSnapshot(
        session([
          new Float32Array(3),
          new Float32Array(new SharedArrayBuffer(24), 12, 3),
          invalid,
        ]),
      ),
    ),
  ).toEqual([invalid.buffer]);
});

it.each(
  [
    [{ sourceToken: -1, sha256: hash }],
    [{ sourceToken: 1, sha256: hash }],
    [{ sourceToken: 0.5, sha256: hash }],
    [{ sourceToken: "0", sha256: hash }],
    [{ sourceToken: 0, sha256: "invalid" }],
    [
      { sourceToken: 0, sha256: hash },
      { sourceToken: 0, sha256: hash },
    ],
    new Array(1),
    Array.from({ length: 129 }, (_, sourceToken) => ({
      sourceToken,
      sha256: hash,
    })),
  ].map((tokens) => ({ tokens })),
)(
  "rejects malformed/sparse/duplicate/out-of-range token replies atomically ($tokens)",
  ({ tokens }) => {
    expect(() =>
      resolveEncodingChunkTokens(tokens, [new SharedArrayBuffer(12)]),
    ).toThrow(/token/);
  },
);

it("rejects sparse, duplicate, private and oversized worker source lists", () => {
  const buffer = new SharedArrayBuffer(12);
  for (const value of [
    new Array(1),
    [buffer, buffer],
    [new ArrayBuffer(12)],
    Array.from({ length: 129 }, () => new SharedArrayBuffer(0)),
  ])
    expect(() => validateEncodingChunkSources(value)).toThrow(/source/);
});

it("rebinds worker hashes to the original source wrapper without returning a worker buffer", () => {
  const original = new SharedArrayBuffer(12),
    request = structuredClone({
      sources: [original],
      view: new Float32Array(original),
    });
  expect(request.sources[0]).toBe(request.view.buffer);
  expect(request.sources[0]).not.toBe(original);
  expect(
    resolveEncodingChunkTokens([{ sourceToken: 0, sha256: hash }], [original]),
  ).toEqual([{ sha256: hash, buffer: original }]);
});

it("captures large ordinary geometry arrays once across current and history", async () => {
  const { projectEncodingNumericSources } =
    await import("../src/project-encoding-chunks");
  const positions = new Array<number>(65538).fill(1);
  const vertices = new Array<number>(65538).fill(2);
  const source = session([new Float32Array(9)]);
  const entity = source.project.entities[0];
  entity.kind = "mesh";
  entity.positions = positions;
  entity.indexedMesh = { vertices, triangles: new Uint32Array([0, 1, 2]) };
  source.history = [{ label: "before", entities: [entity] }];
  expect(
    projectEncodingNumericSources(projectEncodingSnapshot(source)),
  ).toEqual([positions, vertices]);
});
