import { expect, it, vi } from "vitest";
import { BufferAttribute, BufferGeometry } from "three";
import { MeshBVH, type SerializedBVH } from "three-mesh-bvh";

it("transfers disposable picking buffers without duplicating the worker index", async () => {
  let received: SerializedBVH | undefined;
  const scope = {
    onmessage: undefined as undefined | ((event: { data: unknown }) => void),
    postMessage(
      message: { tree: SerializedBVH },
      options: StructuredSerializeOptions,
    ) {
      received = structuredClone(message, options).tree;
    },
  };
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint32Array([0, 1, 2]);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices.slice(), 1));
  const expected = MeshBVH.serialize(new MeshBVH(geometry, { indirect: true }));
  vi.stubGlobal("self", scope);
  try {
    await import("../src/viewport-picking-worker");
    scope.onmessage!({
      data: {
        positions,
        index: indices,
        drawRange: { start: 0, count: Infinity },
        groups: [],
      },
    });
    // The input index belongs to the disposable worker, so it can move directly.
    expect(indices.byteLength).toBe(0);
    expect(received?.index).toEqual(expected.index);
    expect(received?.indirectBuffer).toEqual(expected.indirectBuffer);
    expect(received?.roots.map((root) => new Uint8Array(root))).toEqual(
      expected.roots.map((root) => new Uint8Array(root)),
    );
    expect(positions.byteLength).toBe(36);
  } finally {
    geometry.dispose();
    vi.unstubAllGlobals();
  }
});
