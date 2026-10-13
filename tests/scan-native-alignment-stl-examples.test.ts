import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, it } from "vitest";
import { readScan } from "../src/import-parser";
import { prepareNativeAlignmentSource } from "../src/scan-native-alignment-source";
import { nativeRefineAlignmentMeshes } from "../src/scan-native-alignment-surface-controller";
import sources from "./fixtures/alignment-user-stl-source.json";
import native from "./fixtures/alignment-user-stl-multicore-refinement.json";

const folder = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
const hash = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
async function mesh(expected: (typeof sources.sources)[number]) {
  const bytes = readFileSync(join(folder!, basename(expected.file)));
  expect(hash(bytes)).toBe(expected.sha256);
  let topology: { vertices: Float32Array; triangles: Uint32Array } | undefined;
  await readScan(new Blob([new Uint8Array(bytes)]), "stl", {
    onIndexedMesh: (value) => {
      topology = value;
    },
  });
  expect(topology).toBeDefined();
  expect(hash(new Uint8Array(topology!.vertices.buffer))).toBe(
    expected.topologyVerticesSha256,
  );
  expect(hash(new Uint8Array(topology!.triangles.buffer))).toBe(
    expected.topologyTrianglesSha256,
  );
  return topology!;
}

it.skipIf(!folder).each(sources.sources)(
  "matches original STL normals and sampling: $file",
  async (expected) => {
    const result = prepareNativeAlignmentSource(
      await mesh(expected),
      expected.budget,
    );
    expect(hash(new Uint8Array(result.normals.buffer))).toBe(
      expected.normalsSha256,
    );
    expect(
      hash(new Uint8Array(Uint32Array.from(result.sampling.flags).buffer)),
    ).toBe(expected.flagsSha256);
    expect(result.sampling.levelCounts).toEqual(expected.levelCounts);
    expect(result.sampling.nodes).toBe(expected.nodes);
    expect(
      result.sampling.flags.flatMap((flag, id) => (flag & 4 ? [id] : [])),
    ).toEqual(expected.selected);
  },
  120_000,
);

it.skipIf(!folder).each(native.cases[0].registrations)(
  "matches original two-lane STL refinement: $sourceFile",
  async (expected) => {
    const source = sources.sources.find(
      (source) => source.sha256 === expected.sourceSha256,
    )!;
    const target = sources.sources.find(
      (source) => source.sha256 === native.cases[0].targetSha256,
    )!;
    const started = performance.now();
    const result = nativeRefineAlignmentMeshes(
      [await mesh(source)],
      await mesh(target),
      expected.sampleBudget,
      {
        workerCount: 2,
        initialRadius: expected.initialRadius,
        step: expected.step,
      },
    );
    expect(result.parameters).toEqual(expected.parameters);
    expect(result.initialError).toBe(expected.initialError);
    expect(result.best).toBe(expected.best);
    expect(result.accepted).toBe(expected.accepted);
    expect(result.matrix).toEqual(expected.matrix);
    expect(result.flags).toEqual(expected.laneFlags);
    process.stdout.write(
      JSON.stringify({
        file: expected.sourceFile,
        refinementMilliseconds: performance.now() - started,
        nativeOutputExact: true,
      }) + "\n",
    );
  },
  // The full serial baseline is intentionally retained to constrain acceleration.
  300_000,
);
