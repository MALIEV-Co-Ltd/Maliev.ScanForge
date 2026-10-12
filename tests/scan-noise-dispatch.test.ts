import { afterEach, expect, it, vi } from "vitest";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";
import capture from "./fixtures/noise-annular-selected-3.json";

afterEach(() => vi.unstubAllGlobals());

it("dispatches selected multi-iteration noise through the production async worker without detaching source", async () => {
  const replies: { message: ProcessingResponse; transfers?: Transferable[] }[] =
    [];
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
        iterations: 3,
      },
    },
  });
  const final = replies.at(-1)!;
  if (!("result" in final.message))
    throw new Error("Expected completed noise result");
  expect(Array.from(final.message.result.positions!)).toEqual(
    capture.nativeOutput,
  );
  expect(final.transfers).toEqual([final.message.result.positions!.buffer]);
  expect(Array.from(positions)).toEqual(capture.positions);
  expect(Array.from(selection)).toEqual(capture.selection);
  expect(final.message.result.diagnostics.summary).toContain("3 iteration(s)");
});
