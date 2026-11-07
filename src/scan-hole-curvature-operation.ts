import type { CadClient } from "./cad/client";
import type { MeshProcessingOptions, MeshTopology } from "./mesh-processing";
import { computeAngleWeightedNormals } from "./scan-defeature-repatch";
import {
  nativeCurvatureCollar,
  nativeThinPlateField,
} from "./scan-hole-curvature-field";
import { nativeCurvatureFrame } from "./scan-hole-curvature-frame";
import { interpolateNativeCurvatureGrid } from "./scan-hole-curvature-grid";
import { joinNativeCurvaturePatch } from "./scan-hole-curvature-join";
import { nativeCurvatureWeights } from "./scan-hole-curvature-projection";
import { trimNativeCurvatureMesh } from "./scan-hole-curvature-trim";
import { inverseMirrorFrame } from "./scan-mirror-frame";
import { createNativeAlignmentSurfaceQuery } from "./scan-native-alignment-mesh-query";
import { ALIGNMENT_QUERY_SENTINEL } from "./scan-native-alignment-query";
import { prepareNativeAlignmentSurface } from "./scan-native-alignment-surface";

export function prepareCurvatureSurface(
  source: MeshTopology,
  boundary: readonly number[],
  check?: () => void,
) {
  check?.();
  const collar = nativeCurvatureCollar(source, boundary, check);
  const vertexNormals = computeAngleWeightedNormals(source);
  const normals = collar.indices.map((id) =>
    Array.from(vertexNormals.subarray(id * 3, id * 3 + 3)),
  );
  const frame = nativeCurvatureFrame(collar.vertices, normals, check);
  const matrix = [
    frame.x[0],
    frame.y[0],
    frame.z[0],
    frame.center[0],
    frame.x[1],
    frame.y[1],
    frame.z[1],
    frame.center[1],
    frame.x[2],
    frame.y[2],
    frame.z[2],
    frame.center[2],
  ];
  const inverse = inverseMirrorFrame(matrix);
  const local = collar.vertices.map((point) =>
    [0, 1, 2].map((axis) =>
      Math.fround(
        inverse[axis * 4] * point[0] +
          inverse[axis * 4 + 1] * point[1] +
          inverse[axis * 4 + 2] * point[2] +
          inverse[axis * 4 + 3],
      ),
    ),
  );
  const low = [Infinity, Infinity, Infinity],
    high = [-Infinity, -Infinity, -Infinity];
  for (const point of local)
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], point[axis]);
      high[axis] = Math.max(high[axis], point[axis]);
    }
  const midpoint = low.map((value, axis) => (value + high[axis]) * 0.5);
  const field = nativeThinPlateField(
    local.map((point) => point.map((value, axis) => value - midpoint[axis])),
    { check },
  );
  const grid = Array.from({ length: 21 }, (_, u) =>
    Array.from({ length: 21 }, (_, v) => {
      check?.();
      const x = Math.fround(
        u * ((frame.halfU - -frame.halfU) / 20) + -frame.halfU,
      );
      const y = Math.fround(
        v * ((frame.halfV - -frame.halfV) / 20) + -frame.halfV,
      );
      return [
        x,
        y,
        Math.fround(
          midpoint[2] + field.evaluate(x - midpoint[0], y - midpoint[1]),
        ),
      ];
    }),
  );
  return { patch: interpolateNativeCurvatureGrid(grid, check).patch, matrix };
}

/** One request-owned CAD surface; its handle never enters the scene or history. */
export async function fillNativeCurvaturePatch(
  source: MeshTopology,
  boundary: readonly number[],
  kernel: Pick<CadClient, "curvatureSurface" | "curvatureEvaluate" | "release">,
  options: MeshProcessingOptions = {},
) {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  check();
  options.onProgress?.(0.1, "Fitting Curvature collar");
  const { patch, matrix } = prepareCurvatureSurface(source, boundary, check);
  const mesh = await kernel.curvatureSurface(patch, matrix);
  try {
    check();
    if (
      mesh.vertices.length / 3 > 1_000_000 ||
      mesh.triangles.length / 3 > 1_000_000 ||
      mesh.uvs.length !== mesh.vertices.length
    )
      throw new Error("Curvature surface exceeds its resource budget.");
    options.onProgress?.(0.4, "Projecting Curvature boundary");
    const prepared = prepareNativeAlignmentSurface(
      mesh.vertices,
      mesh.triangles,
      { signal: options.signal },
    );
    if (!prepared)
      throw new Error(
        "Curvature surface could not prepare a projection target.",
      );
    const query = createNativeAlignmentSurfaceQuery(prepared.surface, {
      includeTriangle: true,
    });
    const boundaryUV = boundary.map((id) => {
      check();
      const point = Array.from(source.vertices.subarray(id * 3, id * 3 + 3));
      const hit = query(point, ALIGNMENT_QUERY_SENTINEL);
      if (!hit || hit.triangle === undefined)
        throw new Error("Curvature boundary has no surface projection.");
      const ids = Array.from(
        mesh.triangles.subarray(hit.triangle * 3, hit.triangle * 3 + 3),
      );
      const points = ids.map((vertex) =>
        Array.from(mesh.vertices.subarray(vertex * 3, vertex * 3 + 3)),
      );
      const weights = nativeCurvatureWeights(
        points[0],
        points[1],
        points[2],
        hit.closest,
      );
      if (!weights)
        throw new Error("Curvature boundary projection is singular.");
      return [0, 1, 2].map(
        (axis) =>
          weights[0] * mesh.uvs[ids[0] * 3 + axis] +
          weights[1] * mesh.uvs[ids[1] * 3 + axis] +
          weights[2] * mesh.uvs[ids[2] * 3 + axis],
      );
    });
    options.onProgress?.(0.55, "Trimming Curvature surface");
    const cap = trimNativeCurvatureMesh(
      { vertices: Float32Array.from(mesh.uvs), triangles: mesh.triangles },
      boundaryUV,
      check,
    );
    const uvs = new Float64Array(cap.vertices.length + boundary.length * 3);
    uvs.set(cap.vertices);
    for (let i = 0; i < boundary.length; i++)
      uvs.set(boundaryUV[i], cap.vertices.length + i * 3);
    const world = await kernel.curvatureEvaluate(mesh.kernelId, uvs);
    check();
    if (
      !(world instanceof Float32Array) ||
      world.length !== uvs.length ||
      world.some((value) => !Number.isFinite(value))
    )
      throw new Error(
        "Curvature surface returned invalid evaluated coordinates.",
      );
    options.onProgress?.(0.75, "Stitching Curvature collar");
    return joinNativeCurvaturePatch(
      source,
      {
        boundary,
        boundaryUV,
        boundaryWorld: boundary.map((_, i) =>
          Array.from(
            world.subarray(
              cap.vertices.length + i * 3,
              cap.vertices.length + (i + 1) * 3,
            ),
          ),
        ),
        cap: {
          vertices: world.subarray(0, cap.vertices.length),
          uvs: cap.vertices,
          triangles: cap.triangles,
        },
      },
      check,
    );
  } finally {
    await kernel.release([mesh.kernelId]);
  }
}
