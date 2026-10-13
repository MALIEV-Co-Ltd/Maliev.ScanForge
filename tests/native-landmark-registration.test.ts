import { expect, it, vi, afterEach } from "vitest";
import { registerNativeLandmarks } from "../src/native-landmark-registration";
import { inverseMirrorFrame } from "../src/scan-mirror-frame";
import fixture from "./fixtures/alignment-registration-native.json";
import inputs from "./fixtures/alignment-npoints-native.json";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";

afterEach(() => vi.unstubAllGlobals());
const captures = fixture.cases.filter(
  (capture) =>
    inputs.cases.find((row) => row.name === capture.name)!.source.length >= 3,
);
it.each(captures)(
  "adapts the original wrapper direction and RMS: $name",
  (capture) => {
    const input = inputs.cases.find((row) => row.name === capture.name)!;
    const source = input.source.flat(),
      target = input.target.flat();
    const before = [...source];
    if (!capture.accepted) {
      expect(() => registerNativeLandmarks(source, target)).toThrow(
        "collinear or clustered",
      );
      return;
    }
    const result = registerNativeLandmarks(source, target);
    const expected = inverseMirrorFrame(capture.matrix);
    expect(result.transform.rotation).toEqual([
      expected[0],
      expected[1],
      expected[2],
      expected[4],
      expected[5],
      expected[6],
      expected[8],
      expected[9],
      expected[10],
    ]);
    expect(result.transform.translation).toEqual([
      expected[3],
      expected[7],
      expected[11],
    ]);
    expect(result.rms).toBe(capture.rms);
    expect(source).toEqual(before);
  },
);
it("validates counts, finite coordinates, native spread gate and cancellation", () => {
  expect(() => registerNativeLandmarks([0, 0, 0], [])).toThrow("counts");
  expect(() => registerNativeLandmarks([0, 0, 0], [0, 0, 0])).toThrow(
    "at least three",
  );
  expect(() =>
    registerNativeLandmarks(
      [0, 0, 0, 10, 0, 0, 0, NaN, 0],
      [0, 0, 0, 10, 0, 0, 0, 10, 0],
    ),
  ).toThrow("finite");
  expect(() =>
    registerNativeLandmarks(
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
    ),
  ).toThrow("clustered");
  const signal = AbortSignal.abort();
  expect(() =>
    registerNativeLandmarks(
      [0, 0, 0, 10, 0, 0, 0, 10, 0],
      [0, 0, 0, 10, 0, 0, 0, 10, 0],
      { signal },
    ),
  ).toThrow("cancelled");
});
it("uses the recovered wrapper in the actual shared processing worker", async () => {
  const input = inputs.cases.find((row) => row.name === "noisy-8")!;
  const source = input.source.flat(),
    target = input.target.flat();
  const positions = new Float32Array([...source, 100, 200, 300]);
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      ((event: { data: ProcessingRequest }) => Promise<void>) | null,
    postMessage: (message: ProcessingResponse) => replies.push(message),
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("../src/processing-worker");
  await scope.onmessage!({
    data: {
      kind: "paired",
      positions,
      sourceLandmarks: source,
      targetLandmarks: target,
    },
  });
  const reply = replies.at(-1)!;
  if (!("result" in reply)) throw Error(JSON.stringify(reply));
  expect(reply.result.registration).toEqual(
    registerNativeLandmarks(source, target),
  );
  expect(reply.result.diagnostics.algorithm).toBe(
    "native-landmark-registration",
  );
  expect(reply.result.positions).toHaveLength(positions.length);
  expect(positions).toEqual(new Float32Array([...source, 100, 200, 300]));
});
