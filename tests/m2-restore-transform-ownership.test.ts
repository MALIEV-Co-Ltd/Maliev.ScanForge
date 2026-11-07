import { expect, it } from "vitest";
import {
  packProjectTransport,
  unpackProjectTransport,
} from "../src/project-transport";
import { runScanTool, type ScanToolOperation } from "../src/scan-tools";
import { runScanEdit, type ScanEditRequest } from "../src/scan-edit";
it("preserves restored numeric geometry through representative M2 transforms", async () => {
  const triangle = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const positions = Array.from({ length: 65538 }, (_, i) => triangle[i % 9]);
  const before = positions.slice();
  const packed = await packProjectTransport({ positions });
  let ran = false;
  const out = await unpackProjectTransport<{ positions: number[] }>(
    packed.packet,
    {
      check: () => {
        if (ran) return;
        ran = true;
        const operations: ScanToolOperation[] = [
          { kind: "scaleMesh", factor: 2 },
          { kind: "flipNormals" },
          { kind: "mirrorMesh", center: [0, 0, 0], normal: [1, 0, 0] },
        ];
        for (const operation of operations) {
          const result = runScanTool({
            kind: "scanTools",
            positions,
            operation,
          });
          expect(result.positions).not.toBe(positions);
        }
      },
      releaseOwnedNumericBuffers: true,
    },
  );
  expect(ran).toBe(true);
  expect(positions).toEqual(before);
  expect(out.positions).not.toBe(positions);
  expect(out.positions).toEqual(before);
});

const cubePoints = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
const cubeFaces = [
  [0, 2, 1],
  [0, 3, 2],
  [0, 1, 5],
  [0, 5, 4],
  [1, 2, 6],
  [1, 6, 5],
  [2, 3, 7],
  [2, 7, 6],
  [3, 0, 4],
  [3, 4, 7],
];
const cube = cubeFaces.flatMap((face) => face.flatMap((id) => cubePoints[id]));
const repairCases: Array<{
  name: string;
  request: Partial<ScanEditRequest>;
  error?: string;
}> = [
  { name: "inventory", request: { action: "inventory" } },
  { name: "extract", request: { action: "componentExtract", indices: [1] } },
  { name: "keep", request: { action: "componentKeep", indices: [0] } },
  { name: "remove", request: { action: "componentRemove", indices: [1] } },
  { name: "flip", request: { action: "componentFlip", indices: [0] } },
  { name: "flat fill", request: { action: "fillHoles", algorithm: "flat" } },
  {
    name: "boundary smooth",
    request: { action: "boundarySmooth", strength: 0.5 },
  },
  {
    name: "selected smooth",
    request: {
      action: "smoothSelected",
      selection: new Uint8Array(20).fill(1),
    },
  },
  {
    name: "plane split",
    request: {
      action: "split",
      plane: { origin: [0.5, 0, 0], normal: [1, 0, 0] },
    },
  },
  {
    name: "rejected hole selection",
    request: { action: "fillHoles", indices: [99] },
    error: "closed",
  },
];

it.each(repairCases)(
  "preserves restored geometry during and after $name",
  async ({ request, error }) => {
    const positions = [
      ...cube,
      ...cube.map((value, index) => value + (index % 3 === 0 ? 3 : 0)),
    ];
    const before = positions.slice();
    const ref = {};
    let ran = false;
    const edit = () => {
      const execute = () =>
        runScanEdit({
          kind: "scanEdit",
          positions,
          ...request,
        } as ScanEditRequest);
      if (error) {
        expect(execute).toThrow(error);
        return;
      }
      const result = execute();
      if (request.action === "inventory")
        expect(result.inventory!.components).toHaveLength(2);
      else if (
        request.action === "componentExtract" ||
        request.action === "split"
      )
        expect(result.segments!.length).toBeGreaterThan(0);
      else expect(result.positions!.length).toBeGreaterThan(0);
      return result;
    };
    const restored = await unpackProjectTransport<{ positions: number[] }>(
      {
        kind: "scanforge-numeric-transport-v1",
        graph: { positions: ref },
        numbers: [{ ref, values: Float64Array.from(positions) }],
      },
      {
        check: () => {
          if (!ran) {
            ran = true;
            edit();
          }
        },
      },
    );
    expect(ran).toBe(true);
    expect(restored.positions).not.toBe(positions);
    expect(positions).toEqual(before);
    edit();
    expect(restored.positions).toEqual(before);
  },
);
