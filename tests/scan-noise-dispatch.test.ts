import { afterEach, expect, it, vi } from "vitest";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";
import selected3 from "./fixtures/noise-annular-selected-3.json";
import selected1 from "./fixtures/noise-annular-selected-1.json";

afterEach(() => vi.unstubAllGlobals());

it.each([selected1, selected3])(
  "dispatches selected $iterations-iteration noise through the production async worker without detaching source",
  async (capture) => {
    const replies: {
      message: ProcessingResponse;
      transfers?: Transferable[];
    }[] = [];
    const scope = {
      onmessage: null as
        ((event: { data: ProcessingRequest }) => Promise<void>) | null,
      postMessage: (message: ProcessingResponse, transfers?: Transferable[]) =>
        replies.push({ message, transfers }),
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("../src/processing-worker");
    const positions = new Float32Array(capture.positions);
    const selection = new Uint8Array(capture.selection);
    await scope.onmessage!({
      data: {
        kind: "scanTools",
        positions,
        operation: {
          kind: "reduceNoise",
          selection,
          selectionOnly: true,
          iterations: capture.iterations,
          measureDeviation: true,
        },
      },
    });
    const final = replies.at(-1)!;
    if (!("result" in final.message))
      throw new Error("Expected completed noise result");
    expect(Array.from(final.message.result.positions!)).toEqual(
      capture.nativeOutput,
    );
    expect(final.message.result.noiseComparison?.rgb.length).toBe(
      positions.length,
    );
    expect(final.message.result.noiseComparison?.threshold).toBe(0.05);
    expect(final.transfers).toEqual([
      final.message.result.positions!.buffer,
      final.message.result.noiseComparison!.rgb.buffer,
    ]);
    expect(Array.from(positions)).toEqual(capture.positions);
    expect(Array.from(selection)).toEqual(capture.selection);
    expect(final.message.result.diagnostics.summary).toContain(
      `${capture.iterations} iteration(s)`,
    );
  },
);
