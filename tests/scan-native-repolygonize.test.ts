import { BoxGeometry } from "three";
import { expect, it } from "vitest";
import { runScanTool } from "../src/scan-tools";
import fixture from "./fixtures/repolygonize-observed-tilted-box.json";
import { nativeRepolygonizeScanMesh } from "../src/scan-native-repolygonize";
import { admitReconstructionTransport } from "../src/scan-reconstruction-input";

it("matches every ordered native Float32 corner of the indexed tilted-box GUI export", () => {
  const vertices = Float32Array.from(fixture.vertices.flat());
  const triangles = Uint32Array.from(fixture.faces.flat());
  const positions = Float32Array.from(
    Array.from(triangles).flatMap((id) =>
      Array.from(vertices.subarray(id * 3, id * 3 + 3)),
    ),
  );
  const result = nativeRepolygonizeScanMesh(positions, {
    resolution: fixture.resolution,
    sourceTopology: { vertices, triangles },
  });
  expect(result.positions).toEqual(Float32Array.from(fixture.nativeOutput));
  expect(result.positions.length / 9).toBe(fixture.nativeTriangles);
  expect(result.indexedMesh?.triangles).toHaveLength(
    fixture.nativeTriangles * 3,
  );
});

it("routes Re-polygonize through signed field extraction and the native default simplifier", () => {
  const geometry = new BoxGeometry(4, 2.6, 1.6).toNonIndexed();
  geometry.rotateY(0.19);
  geometry.rotateZ(0.31);
  geometry.translate(2.3, 1.7, -0.8);
  const positions = new Float32Array(geometry.getAttribute("position").array);
  geometry.dispose();
  const before = positions.slice();
  const result = runScanTool({
    kind: "scanTools",
    positions,
    operation: { kind: "repolygonize", resolution: 0.5 },
  });
  expect(result.diagnostics).toMatchObject({
    extraction: "native-signed-corner-field",
    simplify: true,
  });
  expect(result.positions.length).toBeGreaterThan(0);
  expect(positions).toEqual(before);
});

it("preserves the existing voxel reconstruction as an explicit method", () => {
  const positions = Float32Array.from(
    fixture.faces.flatMap((face) => face.flatMap((id) => fixture.vertices[id])),
  );
  const result = runScanTool({
    kind: "scanTools",
    positions,
    operation: { kind: "repolygonize", method: "voxel", resolution: 0.5 },
  });
  expect(result.diagnostics?.watertight).toBe(true);
  expect(result.diagnostics?.extraction).toBe("face-consistent-cube-contours");
});

it("cancels native reconstruction atomically during output verification", () => {
  const positions = Float32Array.from(
      fixture.faces.flatMap((face) =>
        face.flatMap((id) => fixture.vertices[id]),
      ),
    ),
    before = positions.slice();
  const controller = new AbortController();
  expect(() =>
    nativeRepolygonizeScanMesh(positions, {
      signal: controller.signal,
      onProgress(_f, stage) {
        if (stage === "Verifying reconstructed topology") controller.abort();
      },
    }),
  ).toThrow(/cancelled/i);
  expect(positions).toEqual(before);
});

it("includes indexed buffers in admission before copying or reading their coordinates", () => {
  const unread = new Proxy<number[]>([], {
    get(_target, key) {
      if (key === "length") return 150_000_000;
      throw Error("Must reject before reading");
    },
  });
  expect(() =>
    admitReconstructionTransport(
      [new Float32Array(9)],
      [{ vertices: unread, triangles: new Uint32Array([0, 1, 2]) }],
    ),
  ).toThrow(/topology exceeds 256 MiB/);
});
