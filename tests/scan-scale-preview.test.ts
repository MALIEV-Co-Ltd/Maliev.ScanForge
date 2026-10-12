import { afterEach, expect, it, vi } from "vitest";
import { ScanPreviewSession } from "../src/scan-preview";
import capture from "./fixtures/scale-geometry-native.json";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const bits = (p: Float32Array) =>
  Array.from(new Uint8Array(p.buffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const source = (hex: string) =>
  new Float32Array(
    Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16)).buffer,
  );

it.each(capture.cases)(
  "Scale preview matches native $name at factor $factor without topology preparation",
  async (entry) => {
    const positions = source(entry.inputBits);
    const stages: string[] = [];
    const preview = await ScanPreviewSession.create(
      {
        kind: "scanPreview",
        phase: "create",
        previewId: "scale",
        positions,
        operation: { kind: "scaleMesh", factor: entry.factor },
      },
      { onProgress: (_, stage) => stages.push(stage) },
    );
    expect(bits(preview.output)).toBe(entry.nativeBits);
    expect(bits(positions)).toBe(entry.inputBits);
    expect(preview.original).toBeUndefined();
    expect(
      stages.some((stage) => /Welding|Building topology/.test(stage)),
    ).toBe(false);
    expect(() => preview.compare(0.05)).toThrow(
      "does not support surface comparison",
    );
  },
);

it("repeated Scale worker previews read the canonical original rather than compounding previous factors", async () => {
  vi.useFakeTimers();
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      ((e: { data: ProcessingRequest }) => Promise<void>) | null,
    postMessage: (message: ProcessingResponse) => replies.push(message),
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("../src/processing-worker");
  const cases = capture.cases.filter((c) => c.name === "annular");
  const positions = source(cases[0].inputBits);
  for (const [index, entry] of cases.entries()) {
    replies.length = 0;
    await scope.onmessage!({
      data: {
        kind: "scanPreview",
        phase: "create",
        previewId: `scale-${index}`,
        positions: index ? new Float32Array() : positions,
        operation: { kind: "scaleMesh", factor: entry.factor },
        geometryKey: 77,
      } as ProcessingRequest,
    });
    const final = replies.at(-1)!;
    if (!("result" in final)) throw new Error("Scale preview failed");
    expect(bits(final.result.positions!)).toBe(entry.nativeBits);
    expect(bits(positions)).toBe(cases[0].inputBits);
  }
  await vi.runOnlyPendingTimersAsync();
});
