import { expect, it, vi } from "vitest";
import { readScan } from "../src/import-parser";
import { expandPlyTopology } from "../src/ply-topology";
import { indexedMeshMatches } from "../src/indexed-mesh";
import capture from "./fixtures/stl-reader-native.json";

function binary(coordinates: number[]) {
  const data = new ArrayBuffer(84 + (coordinates.length / 9) * 50);
  const view = new DataView(data);
  view.setUint32(80, coordinates.length / 9, true);
  coordinates.forEach((value, i) =>
    view.setFloat32(
      84 + Math.floor(i / 9) * 50 + 12 + (i % 9) * 4,
      value,
      true,
    ),
  );
  return new Blob([data]);
}

for (const sample of capture.samples.filter(
  (sample) => sample.triangles.length,
))
  it(`imports ${sample.name} with complete native reader topology and matching render data`, async () => {
    const onIndexedMesh = vi.fn();
    const progress: number[] = [];
    const positions = await readScan(binary(sample.coordinates), "stl", {
      onIndexedMesh,
      onProgress: (value) => progress.push(value),
    });
    const topology = onIndexedMesh.mock.calls[0][0];
    expect(Array.from(topology.vertices)).toEqual(sample.vertices);
    expect(Array.from(topology.triangles)).toEqual(sample.triangles);
    expect(positions).toEqual(expandPlyTopology(topology));
    expect(indexedMeshMatches(topology, positions)).toBe(true);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, i) => !i || value >= progress[i - 1])).toBe(
      true,
    );
  });

it("retains input facet counts while rejecting collapsed mapped facets", async () => {
  const sample = capture.samples.find((sample) => sample.name === "near-key")!;
  const source = vi.fn();
  const positions = await readScan(binary(sample.coordinates), "stl", {
    onSource: source,
  });
  expect(source.mock.calls[0][0]).toMatchObject({
    triangles: sample.coordinates.length / 9,
    displayedTriangles: sample.triangles.length / 3,
    acceptedTriangles: sample.triangles.length / 3,
  });
  expect(positions.length).toBe(sample.triangles.length * 3);
});

it("does not advertise complete topology for a sampled preview", async () => {
  const sample = capture.samples[0];
  const indexed = vi.fn();
  const positions = await readScan(binary(sample.coordinates), "stl", {
    previewTriangles: 1,
    onIndexedMesh: indexed,
  });
  expect(positions.length).toBe(9);
  expect(indexed).not.toHaveBeenCalled();
});

it("cancels topology construction without publishing partially mapped geometry", async () => {
  const controller = new AbortController();
  const indexed = vi.fn();
  await expect(
    readScan(binary(capture.samples[0].coordinates), "stl", {
      signal: controller.signal,
      onIndexedMesh: indexed,
      onProgress: (fraction) => {
        if (fraction > 0.5) controller.abort();
      },
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(indexed).not.toHaveBeenCalled();
});

it("rejects geometry with no accepted native facets", async () => {
  const sample = capture.samples.find((sample) => sample.name === "collapsed")!;
  await expect(readScan(binary(sample.coordinates), "stl")).rejects.toThrow(
    "no accepted triangles",
  );
});
