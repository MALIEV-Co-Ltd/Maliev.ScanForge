import { expect, it, vi, afterEach } from "vitest";
import native from "./fixtures/alignment-cloud-pose-native.json";
import {
  beginLandmarkAlignment,
  acceptLandmarkAlignment,
} from "../src/landmark-alignment";
import { transformDatumScan } from "../src/datum-alignment";
import { nativeDatumInverseFrame } from "../src/scan-native-datum-apply";
import { cloudPlacement } from "../src/point-cloud-placement";
import type { Entity } from "../src/types";
import { processScanRegistration } from "../src/scan-registration";
import { processMesh, type ProcessingResult } from "../src/processing-client";
import { transformDatumCoordinates } from "../src/datum-transform-kernel";
vi.mock("../src/processing-client", () => ({ processMesh: vi.fn() }));
afterEach(() => {
  vi.clearAllMocks();
});

const floats = (hex: string) => {
  const b = Buffer.from(hex, "hex");
  return Float32Array.from({ length: b.length / 4 }, (_, i) =>
    b.readFloatLE(i * 4),
  );
};
function boundsBits(values: Entity["positions"]) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i++) {
    min[i % 3] = Math.min(min[i % 3], values[i]);
    max[i % 3] = Math.max(max[i % 3], values[i]);
  }
  const bytes = Buffer.alloc(24);
  [...min, ...max].forEach((value, i) => bytes.writeFloatLE(value, i * 4));
  return bytes.toString("hex");
}
it.each(native.cases)(
  "retains native ASC cloud pose on landmark acceptance: $file",
  (sample) => {
    const source: Entity = {
      id: "moving",
      name: sample.file,
      kind: "pointcloud",
      positions: floats(sample.positionsBits),
      normals: Array.from(floats(sample.normalsBits)),
      visible: true,
      opacity: 1,
      color: "#aaa",
    };
    const fixed = { ...source, id: "fixed" };
    const matrix = nativeDatumInverseFrame(sample.steps[0].frame);
    const cloudPreview = transformDatumScan(source, matrix);
    const session = beginLandmarkAlignment(source, fixed);
    const accepted = acceptLandmarkAlignment(
      {
        ...session,
        preview: {
          kind: "paired",
          positions: cloudPreview.positions as Float32Array,
          cloudPreview,
          registration: {
            transform: {
              rotation: [
                matrix[0],
                matrix[1],
                matrix[2],
                matrix[4],
                matrix[5],
                matrix[6],
                matrix[8],
                matrix[9],
                matrix[10],
              ],
              translation: [matrix[3], matrix[7], matrix[11]],
            },
            rms: 0,
            maxError: 0,
            pairs: 3,
            iterations: 1,
            converged: true,
          },
          diagnostics: {},
        },
      },
      [source, fixed],
    );
    expect(cloudPlacement(accepted[0])?.matrixBits).toBe(
      sample.steps[0].poseBits,
    );
    expect(accepted[0].positions).toBe(cloudPreview.positions);
    expect(accepted[1]).toBe(fixed);
    expect(cloudPlacement(accepted[0])?.sourcePositions).toBe(source.positions);
  },
);

it.each(native.cases)(
  "composes all original ASC stages without rounding the old world view: $file",
  async (sample) => {
    const original: Entity = {
      id: "moving",
      name: sample.file,
      kind: "pointcloud",
      positions: floats(sample.positionsBits),
      normals: Array.from(floats(sample.normalsBits)),
      visible: true,
      opacity: 1,
      color: "#aaa",
      meshSelection: { hidden: [1], saved: [] },
    };
    const fixed = { ...original, id: "fixed" };
    let current = original;
    for (const step of sample.steps) {
      const matrix = nativeDatumInverseFrame(step.frame),
        before = current.positions;
      const sourceLandmarks = Array.from(before.slice(0, 9));
      const registration: NonNullable<ProcessingResult["registration"]> = {
        transform: {
          rotation: [
            matrix[0],
            matrix[1],
            matrix[2],
            matrix[4],
            matrix[5],
            matrix[6],
            matrix[8],
            matrix[9],
            matrix[10],
          ],
          translation: [matrix[3], matrix[7], matrix[11]] as [
            number,
            number,
            number,
          ],
        },
        rms: 0,
        maxError: 0,
        pairs: 3,
        iterations: 1,
        converged: true,
      };
      vi.mocked(processMesh).mockResolvedValue({
        kind: "paired",
        registration,
        diagnostics: {},
      });
      const preview = await processScanRegistration(
        current,
        {
          kind: "paired",
          positions: before,
          sourceLandmarks,
          targetLandmarks: Array.from(
            transformDatumCoordinates(sourceLandmarks, matrix),
          ),
        },
        { parallel: false },
      );
      const request = vi.mocked(processMesh).mock.lastCall![0];
      expect(request.positions.length).toBe(0);
      expect(request).toHaveProperty("deferCloudTransform", true);
      expect(current.positions).toBe(before);
      expect(preview.diagnostics.localBuffersRetained).toBe(true);
      expect(preview.diagnostics.pointCloudPose).toBe(step.poseBits);
      const session = beginLandmarkAlignment(current, fixed);
      current = acceptLandmarkAlignment({ ...session, preview }, [
        current,
        fixed,
      ])[0];
      expect(current.kind).toBe("pointcloud");
      expect(current.meshSelection).toBe(original.meshSelection);
      expect(cloudPlacement(current)?.matrixBits).toBe(step.poseBits);
      expect(cloudPlacement(current)?.sourcePositions).toBe(original.positions);
      expect(cloudPlacement(current)?.sourceNormals).toBe(original.normals);
      expect(boundsBits(current.positions)).toBe(step.worldBoundsBits);
      const expected = transformDatumScan(
        original,
        nativeDatumInverseFrame(step.frame),
      );
      if (step === sample.steps[0])
        expect(current.normals).toEqual(expected.normals);
    }
  },
);

it("cancels before native cloud materialization and preserves the original", async () => {
  const source: Entity = {
    id: "moving",
    name: "Cloud",
    kind: "pointcloud",
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
    visible: true,
    opacity: 1,
    color: "#aaa",
  };
  const cancellation = new AbortController();
  cancellation.abort();
  await expect(
    processScanRegistration(
      source,
      {
        kind: "paired",
        positions: source.positions,
        sourceLandmarks: Array.from(source.positions),
        targetLandmarks: Array.from(source.positions),
      },
      { signal: cancellation.signal },
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(processMesh).not.toHaveBeenCalled();
  expect(cloudPlacement(source)).toBeUndefined();
});
