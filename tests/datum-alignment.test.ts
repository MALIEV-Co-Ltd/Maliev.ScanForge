import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-plane-native.json";
import nativeDirections from "./fixtures/alignment-datum-direction-native.json";
import nativePoints from "./fixtures/alignment-datum-point-native.json";
import {
  buildDatumAlignment,
  transformDatumScan,
  type DatumInstruction,
} from "../src/datum-alignment";
import type { NativeDatumPlaneState } from "../src/scan-native-datum-plane";
import { indexedMeshMatches } from "../src/indexed-mesh";
import type { Entity } from "../src/types";
function bits(state: NativeDatumPlaneState) {
  const bytes = Buffer.alloc(0xe8);
  const vector = (values: number[], offset: number) =>
    values.forEach((value, i) => bytes.writeDoubleLE(value, offset + i * 8));
  vector(state.matrix, 0);
  bytes.writeUInt32LE(state.flags, 0x60);
  bytes.writeInt32LE(state.stage, 0x64);
  vector(state.anchor, 0x68);
  vector(state.linePoint, 0x80);
  vector(state.planePoint, 0x98);
  vector(state.lineDirection, 0xb0);
  vector(state.planeNormal, 0xc8);
  bytes.writeInt32LE(state.primaryAxis, 0xe0);
  bytes.writeInt32LE(state.secondaryAxis, 0xe4);
  return bytes.toString("hex");
}
it.each(native.cases)(
  "compiles the complete native plane sequence: $name",
  (sample) => {
    const inputs: DatumInstruction[] = sample.steps.map((step) => ({
      kind: "plane",
      point: step.point,
      direction: step.normal,
      axis: step.axis as 0 | 1 | 2,
      stage: step.stage as 0 | 1 | 2,
    }));
    const before = structuredClone(inputs),
      result = buildDatumAlignment(inputs);
    result.steps.forEach((step, i) => {
      expect(step.accepted).toBe(sample.steps[i].accepted);
      expect(bits(step.state)).toBe(sample.steps[i].nativeBits);
    });
    expect(inputs).toEqual(before);
  },
);
it.each([
  ...nativeDirections.cases.map((sample) => ({
    ...sample,
    kind: "direction" as const,
  })),
  ...nativePoints.cases.map((sample) => ({
    ...sample,
    kind: "point" as const,
  })),
])("compiles the mixed native sequence: $name", (sample) => {
  const setup: DatumInstruction[] = sample.setup.map((step) => ({
    kind:
      step.kind === "line"
        ? "direction"
        : (step.kind as DatumInstruction["kind"]),
    point: step.point,
    direction: "normal" in step ? step.normal : undefined,
    axis: ("axis" in step ? step.axis : 0) as 0 | 1 | 2,
    stage: step.stage as 0 | 1 | 2,
  }));
  const result = buildDatumAlignment([
    ...setup,
    {
      kind: sample.kind,
      point: sample.point,
      direction: "normal" in sample ? sample.normal : undefined,
      axis: ("axis" in sample ? sample.axis : 0) as 0 | 1 | 2,
      stage: sample.stage as 0 | 1 | 2,
    },
  ]);
  expect(result.steps.at(-1)!.accepted).toBe(sample.accepted);
  expect(bits(result.state)).toBe(sample.nativeBits);
  result.steps
    .slice(0, -1)
    .forEach((step, index) =>
      expect(bits(step.state)).toBe(sample.setup[index].nativeBits),
    );
});
it("maps a picked point to the origin and preserves indexed IDs and saved facet selection", () => {
  const positions = new Float32Array([5, 6, 7, 6, 6, 7, 5, 7, 7]);
  const triangles = new Uint32Array([0, 1, 2]);
  const entity: Entity = {
    id: "scan",
    name: "scan",
    kind: "mesh",
    positions,
    indexedMesh: { vertices: positions, triangles },
    color: "#fff",
    opacity: 1,
    visible: true,
    meshSelection: {
      hidden: [0],
      saved: [{ id: "s", name: "s", triangles: [0] }],
    },
  };
  const result = transformDatumScan(
    entity,
    buildDatumAlignment([{ kind: "point", point: [5, 6, 7], axis: 0 }]).matrix,
  );
  expect(Array.from(result.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  expect(result.indexedMesh?.triangles).toBe(triangles);
  expect(result.meshSelection).toBe(entity.meshSelection);
  expect(indexedMeshMatches(result.indexedMesh, result.positions)).toBe(true);
  expect(Array.from(positions)).toEqual([5, 6, 7, 6, 6, 7, 5, 7, 7]);
});
it("rotates point cloud normals without translating them", () => {
  const entity: Entity = {
    id: "cloud",
    name: "cloud",
    kind: "pointcloud",
    positions: new Float32Array([5, 6, 7]),
    normals: [0, 0, 1],
    color: "#fff",
    opacity: 1,
    visible: true,
  };
  const result = transformDatumScan(
    entity,
    [1, 0, 0, -5, 0, 0, -1, 7, 0, 1, 0, -6],
  );
  expect(Array.from(result.positions)).toEqual([0, 0, 0]);
  expect(result.normals).toEqual([0, -1, 0]);
  expect(entity.normals).toEqual([0, 0, 1]);
});
it("rejects unsupported, locked and overflowing targets without modifying them", () => {
  const entity: Entity = {
    id: "mesh",
    name: "mesh",
    kind: "mesh",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    color: "#fff",
    opacity: 1,
    visible: true,
  };
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  expect(() => transformDatumScan({ ...entity, locked: true }, matrix)).toThrow(
    /Unlock/,
  );
  expect(() =>
    transformDatumScan({ ...entity, kernelId: "cad" }, matrix),
  ).toThrow(/exact CAD/);
  expect(() =>
    transformDatumScan(entity, [1, 0, 0, 2e9, 0, 1, 0, 0, 0, 0, 1, 0]),
  ).toThrow(/range/);
  expect(entity.positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
});
