import { expect, it } from "vitest";
import fixture from "./fixtures/boundary-smooth-observed-annulus.json";
import { nativeStlTopology } from "../src/scan-native-stl-topology";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { nativeHoleBoundaryWalks } from "../src/scan-hole-boundary-order";
import {
  smoothingRings,
  smoothingTargets,
  publishSmoothingTargets,
} from "../src/scan-smoothing-kernel";

it("matches native concave-rim coordinates before the separate head projection", () => {
  const indexed = nativeStlTopology(Float32Array.from(fixture.source));
  const topology = analyzeIndexedMesh(
    Float64Array.from(indexed.vertices),
    indexed.triangles,
  );
  const boundary = nativeHoleBoundaryWalks(topology).find(
    (loop) => topology.vertices[loop[0] * 3 + 2] < 0.5,
  )!;
  const targets = new Map<string, number[]>();
  for (let i = 0; i < fixture.source.length; i += 3)
    targets.set(
      JSON.stringify(fixture.source.slice(i, i + 3)),
      fixture.output.slice(i, i + 3),
    );
  const rings = smoothingRings(topology),
    movable = Uint32Array.from(boundary);
  let vertices = topology.vertices.slice();
  for (let step = 0; step < 20; step++)
    vertices = publishSmoothingTargets(
      vertices,
      movable,
      smoothingTargets(vertices, topology.triangles, rings, movable, 0.5),
    );
  // Native whole-loop curve projection changes this one head after smoothing.
  for (const id of boundary.slice(1)) {
    const original = Array.from(topology.vertices.subarray(id * 3, id * 3 + 3));
    expect(
      Array.from(vertices.subarray(id * 3, id * 3 + 3)),
      JSON.stringify(original),
    ).toEqual(targets.get(JSON.stringify(original)));
  }
});
