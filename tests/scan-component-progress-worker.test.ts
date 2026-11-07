import { afterEach, expect, it, vi } from "vitest";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("does not report finished component work before the worker returns the result", async () => {
  const messages: ProcessingResponse[] = [];
  const target = {
    onmessage: null as
      null | ((event: { data: ProcessingRequest }) => Promise<void>),
    postMessage: (message: ProcessingResponse) => messages.push(message),
  };
  vi.stubGlobal("self", target);
  await import("../src/processing-worker");
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 4, 0, 0, 5, 0, 0, 4, 1, 0,
  ]);
  await target.onmessage!({
    data: {
      kind: "scanEdit",
      action: "componentKeep",
      positions,
      sourceIndexed: {
        vertices: positions.slice(),
        triangles: new Uint32Array([0, 1, 2, 3, 4, 5]),
      },
      indices: [0],
    },
  });
  expect(messages.at(-1)).toHaveProperty("result");
  const progress = messages.filter((message) => "progress" in message);
  expect(progress.length).toBeGreaterThan(0);
  expect(progress.every((message) => message.progress < 1)).toBe(true);
  expect(progress.map((message) => message.progress)).toEqual(
    [...progress.map((message) => message.progress)].sort((a, b) => a - b),
  );
});
