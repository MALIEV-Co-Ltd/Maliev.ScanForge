import type { IndexedMesh, Positions } from "./types";
import {
  analyzeIndexedMesh,
  sheetSummary,
  type MeshProcessingOptions,
} from "./mesh-processing";
import type { ScanToolResult } from "./scan-tools-reduction";
import { admitReconstructionInputs } from "./scan-reconstruction-input";
import { indexedMeshMatches } from "./indexed-mesh";
import { meshFacetNormals, meshGeometryNormals } from "./mesh-geometry-normals";
import { nativeStlTopology } from "./scan-native-stl-topology";
import { nativeReductionMesh } from "./scan-native-reduction";
import {
  reconstructionPrepareSharedSource,
  reconstructionSparseAdmission,
  reconstructionFieldOutput,
} from "./scan-native-repolygon-field";
import { reconstructionFinalizeOutput } from "./scan-native-repolygon-finalize";
import type { ReconstructionIndexed } from "./scan-native-repolygon-types";

export interface NativeRepolygonizeOptions extends MeshProcessingOptions {
  resolution?: number;
  targets?: Positions[];
  sourceTopology?: IndexedMesh;
  targetTopology?: (IndexedMesh | undefined)[];
}

/** Field data is disposable; it is released before the simplifier allocates records. */
function reconstruct(
  inputs: Positions[],
  o: NativeRepolygonizeOptions,
  resolution: number,
) {
  const check = () => {
    if (o.signal?.aborted)
      throw new DOMException("Reconstruction cancelled.", "AbortError");
  };
  const bounds = [
    Infinity,
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
    -Infinity,
  ];
  const sources = inputs.map((input, index) => {
    check();
    const hint = index ? o.targetTopology?.[index - 1] : o.sourceTopology;
    if (hint && !indexedMeshMatches(hint, input))
      throw Error(
        "Reconstruction topology does not match its source coordinates.",
      );
    const topology = hint
      ? {
          vertices:
            hint.vertices instanceof Float32Array
              ? hint.vertices
              : Float32Array.from(hint.vertices),
          triangles:
            hint.triangles instanceof Uint32Array
              ? hint.triangles
              : Uint32Array.from(hint.triangles),
        }
      : nativeStlTopology(
          input instanceof Float32Array ? input : Float32Array.from(input),
          { signal: o.signal },
        );
    for (let i = 0; i < topology.vertices.length; i++) {
      if (i % 12288 === 0) check();
      const v = topology.vertices[i],
        axis = i % 3;
      if (!Number.isFinite(v))
        throw Error(
          "Reconstruction coordinates must fit finite Float32 values.",
        );
      bounds[axis] = Math.min(bounds[axis], v);
      bounds[axis + 3] = Math.max(bounds[axis + 3], v);
    }
    o.onProgress?.(
      (0.15 * index) / inputs.length,
      "Preparing native reconstruction source",
    );
    return reconstructionPrepareSharedSource(
      { positions: topology.vertices, indices: topology.triangles },
      { signal: o.signal },
    ).source;
  });
  for (let axis = 0; axis < 3; axis++) {
    const magnitude = Math.max(
      Math.abs(bounds[axis]),
      Math.abs(bounds[axis + 3]),
    );
    if (Math.fround(magnitude + resolution) === Math.fround(magnitude))
      throw Error(
        "Point resolution is too fine for the coordinate magnitude; move the mesh nearer the origin.",
      );
  }
  o.onProgress?.(0.15, "Encoding native signed field");
  const limits = {
    nodes: 1_000_000,
    corners: 750_000,
    candidates: 50_000_000,
    vertices: 2_000_000,
    triangles: 2_000_000,
  };
  const field = reconstructionSparseAdmission({
    bounds: Float32Array.from(bounds),
    spacing: resolution,
    sources,
    origin: [0, 0, 0],
    initialDirection: [0, 0, 0],
    limits,
    signal: o.signal,
    onProgress: (f, stage) => o.onProgress?.(0.15 + f * 0.55, stage),
  });
  o.onProgress?.(0.7, "Extracting native field surface");
  const raw = reconstructionFieldOutput(field, { limits, signal: o.signal });
  const diagnostics = { ...field.diagnostics };
  // Retire extraction data before allocating mutable face records.
  field.root.children = null;
  field.leaves.length = 0;
  field.corners.clear();
  field.frontiers.length = 0;
  sources.length = 0;
  if (
    (raw.positions.length / 3) * 128 + (raw.indices.length / 3) * 512 >
    512 * 1024 * 1024
  )
    throw Error(
      "Reconstruction finalization exceeds its working-memory budget; increase point resolution.",
    );
  const output = reconstructionFinalizeOutput(raw, {
    maxTriangles: limits.triangles,
    signal: o.signal,
  });
  return {
    output,
    diagnostics: {
      ...diagnostics,
      fieldTriangles: output.indices.length / 3,
    },
  };
}

/** Native signed corners, ordered extraction/repair, then the enabled half-count optimization. */
export function nativeRepolygonizeScanMesh(
  positions: Positions,
  o: NativeRepolygonizeOptions = {},
): ScanToolResult {
  const check = () => {
    if (o.signal?.aborted)
      throw new DOMException("Reconstruction cancelled.", "AbortError");
  };
  check();
  const resolution = Math.fround(o.resolution ?? 0.5);
  if (!Number.isFinite(resolution) || resolution <= 2 ** -23)
    throw Error(
      "Point resolution must be finite and greater than Float32 epsilon in mm.",
    );
  const inputs = [positions, ...(o.targets ?? [])];
  admitReconstructionInputs(inputs);
  if (o.targetTopology && o.targetTopology.length !== inputs.length - 1)
    throw Error(
      "Reconstruction topology references must match the input meshes.",
    );
  const { output, diagnostics } = reconstruct(inputs, o, resolution);
  if (!output.indices.length)
    throw Error(
      "No surface found at this point resolution; original meshes retained.",
    );
  let mesh: ReconstructionIndexed = output;
  if (output.indices.length / 6 >= 4) {
    // Bound the object-rich kernel before allocating it, including incidence scratch.
    if (
      (output.positions.length / 3) * 1024 +
        (output.indices.length / 3) * 4096 >
      768 * 1024 * 1024
    )
      throw Error(
        "Reconstruction optimization exceeds its working-memory budget; increase point resolution.",
      );
    const reduced = nativeReductionMesh(
      Float64Array.from(output.positions, Math.fround),
      output.indices,
      Math.floor(output.indices.length / 6),
      {
        signal: o.signal,
        onProgress: (f, stage) => o.onProgress?.(0.75 + f * 0.15, stage),
      },
    );
    mesh = {
      positions: Float32Array.from(reduced.vertices),
      indices: Uint32Array.from(reduced.triangles),
    };
  }
  check();
  o.onProgress?.(0.92, "Verifying reconstructed topology");
  const topology = analyzeIndexedMesh(
    Float64Array.from(mesh.positions),
    mesh.indices,
    { signal: o.signal },
  );
  const summary = sheetSummary(topology);
  const expanded = new Float32Array(mesh.indices.length * 3);
  for (let i = 0; i < mesh.indices.length; i++) {
    if (i % 12288 === 0) check();
    for (let axis = 0; axis < 3; axis++)
      expanded[i * 3 + axis] = mesh.positions[mesh.indices[i] * 3 + axis];
  }
  if (!expanded.every(Number.isFinite))
    throw Error(
      "Reconstruction produced invalid coordinates; original meshes retained.",
    );
  check();
  o.onProgress?.(1, "Reconstruction complete");
  const indexedMesh = { vertices: mesh.positions, triangles: mesh.indices };
  return {
    positions: expanded,
    indexedMesh: {
      ...indexedMesh,
      geometryNormals: meshGeometryNormals(indexedMesh),
      facetNormals: meshFacetNormals(indexedMesh, o.signal),
    },
    topology: summary,
    diagnostics: {
      ...diagnostics,
      extraction: "native-signed-corner-field",
      inputMeshes: inputs.length,
      resolution,
      simplify: true,
      watertight: summary.watertight,
      selfIntersectionsChecked: false,
    },
    summary: `Native field surface: ${summary.triangles} triangles at ${resolution} mm. ${summary.watertight ? "Closed manifold topology." : `${summary.boundaryEdges} boundary edges; ${summary.nonManifoldEdges} nonmanifold edges. Inspect and repair before solid use.`}`,
  };
}
