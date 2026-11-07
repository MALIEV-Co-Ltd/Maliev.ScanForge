import { afterEach, expect, it, vi } from "vitest";
import { materializeFiniteSeams } from "../src/scan-split-finite-seams";
import { runScanEdit } from "../src/scan-edit";
import {
  decodeProjectContents,
  encodeProjectFileLocally,
  type ProjectSession,
  type ProjectSharedChunk,
} from "../src/project-file-codec";
import { indexedMeshMatches } from "../src/indexed-mesh";

afterEach(() => vi.unstubAllGlobals());

it.each([false, true])(
  "retains split and extracted indices through save and reopen with isolation %s",
  async (isolated) => {
    vi.stubGlobal("crossOriginIsolated", isolated);
    const vertices = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 3, 0, 0, 4, 0, 0, 3, 1, 0,
    ]);
    const triangles = new Uint32Array([0, 1, 2, 3, 4, 5]);
    const seam = materializeFiniteSeams(vertices, triangles, new Uint32Array());
    const singleSeam = materializeFiniteSeams(
      vertices,
      triangles.subarray(0, 3),
      new Uint32Array(),
    );
    const extracted = runScanEdit({
      kind: "scanEdit",
      action: "componentExtract",
      positions: vertices,
      sourceIndexed: { vertices, triangles },
      indices: [0],
    }).segmentIndexedMeshes![0]!;
    for (const mesh of [seam, singleSeam, extracted]) {
      if (!(mesh.triangles instanceof Uint32Array))
        throw new Error("Expected typed output indices");
      expect(mesh.triangles.buffer instanceof SharedArrayBuffer).toBe(isolated);
      const positions = Float32Array.from(
        Array.from(mesh.triangles).flatMap((i) =>
          Array.from(mesh.vertices.slice(i * 3, i * 3 + 3)),
        ),
      );
      expect(indexedMeshMatches(mesh, positions)).toBe(true);
      const session: ProjectSession = {
        project: {
          format: "maliev-scanforge",
          version: 1,
          units: "mm",
          name: "indices",
          entities: [
            {
              id: "mesh",
              name: "mesh",
              kind: "mesh",
              color: "#ffffff",
              visible: true,
              opacity: 1,
              positions,
              indexedMesh: mesh,
            },
          ],
        },
        history: [],
        future: [],
      };
      const chunks: ProjectSharedChunk[] = [];
      const file = await encodeProjectFileLocally(session, {
        onSharedChunk: (chunk) => chunks.push(chunk),
      });
      const restored = await decodeProjectContents(file, {
        sharedReadonlyBuffers: true,
        reusableChunks: chunks,
      });
      const restoredIndices =
        restored.project.entities[0].indexedMesh!.triangles;
      if (!(restoredIndices instanceof Uint32Array))
        throw new Error("Expected typed restored indices");
      expect(Array.from(restoredIndices)).toEqual(Array.from(mesh.triangles));
      if (isolated) expect(restoredIndices.buffer).toBe(mesh.triangles.buffer);
      else expect(restoredIndices.buffer).not.toBe(mesh.triangles.buffer);
    }
  },
);

it("uses ordinary buffers if shared buffers are unavailable", () => {
  vi.stubGlobal("crossOriginIsolated", true);
  vi.stubGlobal("SharedArrayBuffer", undefined);
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const triangles = new Uint32Array([0, 1, 2]);
  const seam = materializeFiniteSeams(vertices, triangles, new Uint32Array());
  const extracted = runScanEdit({
    kind: "scanEdit",
    action: "componentExtract",
    positions: vertices,
    sourceIndexed: { vertices, triangles },
    indices: [0],
  }).segmentIndexedMeshes![0]!;
  if (!(extracted.triangles instanceof Uint32Array))
    throw new Error("Expected typed output indices");
  expect(seam.triangles.buffer).toBeInstanceOf(ArrayBuffer);
  expect(extracted.triangles.buffer).toBeInstanceOf(ArrayBuffer);
});
