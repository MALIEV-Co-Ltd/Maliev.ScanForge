import { expect, it, vi } from "vitest";
import { BufferAttribute, BufferGeometry } from "three";
import { MeshBVH, type SerializedBVH } from "three-mesh-bvh";

it("transfers picking roots and facet mapping without returning the unused index", async () => {
  let received: SerializedBVH | undefined;
  let transferred: Transferable[] | undefined;
  const scope = {
    onmessage: undefined as undefined | ((event: { data: unknown }) => void),
    postMessage(
      message: { tree: SerializedBVH },
      options: StructuredSerializeOptions,
    ) {
      transferred = options.transfer;
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
    expect(indices.byteLength).toBe(12);
    expect(transferred).not.toContain(indices.buffer);
    expect(transferred).toHaveLength(expected.roots.length + 1);
    expect(received?.index).toBeNull();
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
