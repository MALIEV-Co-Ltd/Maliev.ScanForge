import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("restores private decoded vertex ownership before encoding indexed normals", async () => {
  const target = { onmessage: undefined as unknown, postMessage: vi.fn() };
  vi.stubGlobal("self", target);
  await import("../src/stl-export-worker");
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const vertices = new Float64Array(positions);
  const handler = target.onmessage as (event: unknown) => void;
  handler({
    data: {
      entities: [
        {
          id: "decoded",
          name: "decoded",
          kind: "mesh",
          positions,
          indexedMesh: {
            vertices,
            triangles: new Uint32Array([0, 1, 2]),
            geometryNormals: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
          },
          privateIndexedVertices: true,
          visible: true,
          color: "#ffffff",
          opacity: 1,
        },
      ],
    },
  });
  expect(target.postMessage).toHaveBeenCalledTimes(2);
  expect(target.postMessage.mock.calls[0][0]).toEqual({ started: true });
  const [message, options] = target.postMessage.mock.calls[1];
  expect(message.error).toBeUndefined();
  const output = new DataView(message.buffer);
  expect([0, 1, 2].map((i) => output.getFloat32(84 + i * 4, true))).toEqual(
    Array(3).fill(Math.fround(1 / 3)),
  );
  expect(options.transfer).toEqual([message.buffer]);
  expect(Array.from(vertices)).toEqual(Array.from(positions));
});
