import { afterEach, expect, it, vi } from "vitest";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
  type ProjectSession,
} from "../src/project-file-codec";

const STAGING_BYTES = 1024 * 1024;
function session(positions: Float32Array | number[]): ProjectSession {
  const entity = {
    id: "scan",
    name: "Scan",
    kind: "mesh" as const,
    positions,
    color: "#ffffff",
    visible: true,
    opacity: 1,
  };
  return {
    project: {
      format: "maliev-scanforge",
      version: 1,
      units: "mm",
      name: "Scanner",
      entities: [entity],
    },
    history: [{ label: "Import", entities: [entity] }],
    future: [],
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("bounds numeric encoding staging to one MiB while retaining every value", async () => {
  const count = Math.ceil((STAGING_BYTES / 4 + 1) / 9) * 9;
  const positions = Float32Array.from({ length: count }, (_, i) =>
    i % 9 === 0 ? -0 : (i % 19) / 7,
  );
  let maximum = 0;
  const RecordingBytes = new Proxy(Uint8Array, {
    construct(target, args, newTarget) {
      if (typeof args[0] === "number") maximum = Math.max(maximum, args[0]);
      return Reflect.construct(target, args, newTarget);
    },
  });
  vi.stubGlobal("Uint8Array", RecordingBytes);
  const encoded = await encodeProjectFileLocally(session(positions));
  vi.unstubAllGlobals();
  expect(maximum).toBeLessThanOrEqual(STAGING_BYTES);
  const restored = await decodeProjectContents(encoded);
  expect(restored.project.entities[0].positions).toEqual(positions);
  expect(restored.history[0].entities[0].positions).toBe(
    restored.project.entities[0].positions,
  );
});

it("consumes compressed output as a Blob rather than materializing a whole compressed byte array", async () => {
  const materialize = vi
    .spyOn(Response.prototype, "arrayBuffer")
    .mockImplementation(async () => {
      throw Error("Whole compressed array forbidden");
    });
  const encoded = await encodeProjectFileLocally(session(new Float32Array(9)));
  expect(encoded.size).toBeGreaterThan(16);
  expect(materialize).not.toHaveBeenCalled();
});
