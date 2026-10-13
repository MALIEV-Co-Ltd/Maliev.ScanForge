import { afterEach, expect, it, vi } from "vitest";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";
import selected1 from "./fixtures/noise-annular-selected-1.json";
import selected2 from "./fixtures/noise-annular-selected-2.json";
import selected3 from "./fixtures/noise-annular-selected-3.json";
import selected4 from "./fixtures/noise-annular-selected-4.json";
import selected5 from "./fixtures/noise-annular-selected-5.json";
import locked from "./fixtures/noise-annular-selected-boundary-off.json";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("reused production previews preserve all ten native selected iteration captures after output transfer", async () => {
  vi.useFakeTimers();
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      ((event: { data: ProcessingRequest }) => Promise<void>) | null,
    postMessage(message: ProcessingResponse, transfers?: Transferable[]) {
      // Detach published buffers just as the browser worker transport does.
      replies.push(structuredClone(message, { transfer: transfers ?? [] }));
    },
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("../src/processing-worker");
  const source = new Float32Array(selected1.positions);
  const before = new Uint8Array(source.buffer).slice();
  const captures = [
    selected1,
    selected2,
    selected3,
    selected4,
    selected5,
    ...locked.cases.map((capture) => ({
      ...capture,
      selection: locked.selection,
    })),
    selected1,
  ];
  for (const [index, capture] of captures.entries()) {
    replies.length = 0;
    const selection = new Uint8Array(capture.selection);
    const previewId = `selected-${index}`;
    await scope.onmessage!({
      data: {
        kind: "scanPreview",
        phase: "create",
        previewId,
        positions: index === 0 ? source : new Float32Array(),
        geometryKey: 731,
        operation: {
          kind: "reduceNoise",
          iterations: capture.iterations,
          selectionOnly: true,
          selection,
          applyBoundaryEdges: capture.applyBoundaryEdges,
        },
      } as ProcessingRequest,
    });
    const final = replies.at(-1)!;
    if (!("result" in final)) throw new Error("Missing selected noise preview");
    expect(new Uint8Array(final.result.positions!.buffer)).toEqual(
      new Uint8Array(new Float32Array(capture.nativeOutput).buffer),
    );
    expect(selection).toEqual(new Uint8Array(capture.selection));
    if (index > 0)
      expect(
        replies.some(
          (message) =>
            "stage" in message &&
            /Welding|Building topology/.test(message.stage),
        ),
      ).toBe(false);
    replies.length = 0;
    await scope.onmessage!({
      data: {
        kind: "scanPreview",
        phase: "compare",
        previewId,
        positions: new Float32Array(),
        geometryKey: 731,
        deviation: 0.05,
      } as ProcessingRequest,
    });
    const comparison = replies.at(-1)!;
    if (!("result" in comparison))
      throw new Error("Missing preview comparison");
    expect(comparison.result.positions).toBeUndefined();
    expect(comparison.result.noiseComparison!.rgb.length).toBe(source.length);
    expect(
      replies.some(
        (message) =>
          "stage" in message &&
          /Welding|Building topology|Reducing mesh noise/.test(message.stage),
      ),
    ).toBe(false);
    expect(new Uint8Array(source.buffer)).toEqual(before);
  }
});
