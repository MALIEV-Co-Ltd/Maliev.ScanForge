import { BufferAttribute, BufferGeometry, Matrix4 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { MeshProcessingOptions } from "./mesh-processing";
import {
  isDegenerateFloat32Triangle,
  trianglesIntersectBeyondSharedTopology,
} from "./scan-self-intersection-predicate";

export interface SelfIntersectionOptions extends MeshProcessingOptions {
  /** Local outputs copy unchanged facets first; omit to check the entire mesh. */
  firstChangedFace?: number;
  maxCandidatePairs?: number;
}
/** Exhaustive Float32 surface audit. Only exact shared vertices/edges are allowed.
 * BVH overlap is a conservative broad phase; exact orientation predicates decide
 * actual contact. Throws on cancellation/limits rather than reporting a partial zero. */
export function verifyMeshSelfIntersections(
  positions: Float32Array,
  options: SelfIntersectionOptions = {},
) {
  const count = positions.length / 9;
  const firstChangedFace = options.firstChangedFace ?? 0;
  const limit = options.maxCandidatePairs ?? 500_000_000;
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException(
        "Self-intersection verification cancelled.",
        "AbortError",
      );
  };
  check();
  if (!Number.isInteger(count) || count < 1 || count > 16_000_000)
    throw Error(
      "Self-intersection verification requires complete triangles within the sixteen-million-face limit.",
    );
  if (
    !Number.isInteger(firstChangedFace) ||
    firstChangedFace < 0 ||
    firstChangedFace > count
  )
    throw Error(
      "Invalid changed-face boundary for self-intersection verification.",
    );
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw Error("Self-intersection candidate-pair limit must be positive.");
  for (let i = 0; i < positions.length; i++) {
    if ((i & 32767) === 0) check();
    if (!Number.isFinite(positions[i]))
      throw Error("Self-intersection coordinates must be finite.");
  }
  for (let face = 0; face < count; face++) {
    if ((face & 4095) === 0) check();
    if (isDegenerateFloat32Triangle(positions, face))
      throw Error(
        "Self-intersection verification requires nondegenerate triangles.",
      );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  let candidates = 0,
    tested = 0,
    intersections = 0,
    ranges = 0;
  const examples: [number, number][] = [];
  let failure: unknown;
  let failed = false;
  try {
    options.onProgress?.(0, "Indexing self-intersection verification");
    check();
    const tree = new MeshBVH(geometry, {
      targetLeafSize: 12,
      onProgress: (f) => {
        check();
        options.onProgress?.(
          0.25 * f,
          "Indexing self-intersection verification",
        );
        check();
      },
    });
    // Padded Float32 BVH bounds can overflow even when all input coordinates are finite.
    // Identity box transforms of Infinity create NaNs and could prune real intersections.
    let coveredFaces = 0;
    for (const root of MeshBVH.serialize(tree, { cloneBuffers: false }).roots) {
      const bounds = new Float32Array(root);
      const words = new Uint32Array(root),
        shorts = new Uint16Array(root);
      for (let node = 0; node < bounds.length; node += 8) {
        if ((node & 32767) === 0) check();
        if (shorts[node * 2 + 15] === 0xffff) {
          const offset = words[node + 6],
            leafCount = shorts[node * 2 + 14];
          if (
            !leafCount ||
            offset !== coveredFaces ||
            offset + leafCount > count
          )
            throw Error(
              "Self-intersection BVH leaf coverage is incomplete; coincident triangles or an index limit prevented exhaustive verification.",
            );
          coveredFaces += leafCount;
        }
        for (let axis = 0; axis < 6; axis++)
          if (!Number.isFinite(bounds[node + axis]))
            throw Error(
              "Self-intersection BVH bounds exceed finite Float32 range; move the mesh nearer the origin or rescale it.",
            );
      }
    }
    if (coveredFaces !== count)
      throw Error(
        "Self-intersection BVH leaf coverage does not match the source triangle count.",
      );
    const index = geometry.index!.array;
    options.onProgress?.(0.25, "Checking self-intersection pairs");
    check();
    tree.bvhcast(tree, new Matrix4(), {
      intersectsRanges(offsetA, countA, offsetB, countB) {
        // Never throw inside bvhcast: its library traversal state is shared.
        try {
          if ((ranges++ & 4095) === 0) {
            check();
            options.onProgress?.(
              0.25 + 0.74 * Math.min(1, candidates / Math.max(1, count * 80)),
              "Checking self-intersection pairs",
            );
            check();
          }
          if (offsetA >= offsetB + countB) return false;
          for (let a = offsetA; a < offsetA + countA; a++) {
            const faceA = index[a * 3] / 3;
            for (let b = Math.max(offsetB, a + 1); b < offsetB + countB; b++) {
              const faceB = index[b * 3] / 3;
              if (faceA < firstChangedFace && faceB < firstChangedFace)
                continue;
              if (++candidates > limit)
                throw Error(
                  "Self-intersection candidate-pair limit exceeded; split the mesh or selected region.",
                );
              const ai = faceA * 9,
                bi = faceB * 9;
              let overlap = true;
              for (let axis = 0; axis < 3; axis++) {
                if (
                  Math.max(
                    positions[ai + axis],
                    positions[ai + 3 + axis],
                    positions[ai + 6 + axis],
                  ) <
                    Math.min(
                      positions[bi + axis],
                      positions[bi + 3 + axis],
                      positions[bi + 6 + axis],
                    ) ||
                  Math.max(
                    positions[bi + axis],
                    positions[bi + 3 + axis],
                    positions[bi + 6 + axis],
                  ) <
                    Math.min(
                      positions[ai + axis],
                      positions[ai + 3 + axis],
                      positions[ai + 6 + axis],
                    )
                ) {
                  overlap = false;
                  break;
                }
              }
              if (!overlap) continue;
              tested++;
              if (
                trianglesIntersectBeyondSharedTopology(positions, faceA, faceB)
              ) {
                intersections++;
                if (examples.length < 16)
                  examples.push(
                    faceA < faceB ? [faceA, faceB] : [faceB, faceA],
                  );
              }
            }
          }
        } catch (error) {
          failure = error;
          failed = true;
          return true;
        }
        return false;
      },
    });
    if (failed) throw failure;
    check();
    options.onProgress?.(1, "Self-intersection verification complete");
    check();
    examples.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return {
      selfIntersectionsChecked: true,
      selfIntersectionPairs: intersections,
      selfIntersectionExamples: examples,
      selfIntersectionCandidatePairs: candidates,
      selfIntersectionTestedPairs: tested,
      selfIntersectionMethod:
        "exhaustive BVH broad phase with exact Float32 orientation predicates",
      selfIntersectionScope:
        firstChangedFace === 0
          ? "whole mesh"
          : "changed facets against whole parent",
      selfIntersectionTriangles: count,
      selfIntersectionIndexFaces: coveredFaces,
    };
  } finally {
    geometry.dispose();
  }
}
