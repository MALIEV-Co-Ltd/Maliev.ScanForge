import { refineFiniteCutterFromSource } from "./scan-split-finite-pipeline";
import { materializeFiniteSeams } from "./scan-split-finite-seams";
import { groupFiniteTrianglesCompact } from "./scan-split-finite-group";
import { partitionFiniteIndexedParts } from "./scan-split-finite-parts";

type CandidateOptions = {
  signal?: AbortSignal;
  selection?: Uint8Array;
  tolerance?: number;
  maxTypedBytesPerStage?: number;
  maxWork?: number;
  onProgress?: (fraction: number, stage: string) => void;
  preciseCoordinates?: boolean;
  outputMode?: "parts" | "single-mesh";
};
type CandidateDiagnostics = {
  affectedFaces: number;
  sourceFaces: number;
  parts: number;
  cutEdges: number;
  sourceIdentity: "retained-indexed" | "exact-corner-index";
};
type CandidateResult<T extends Float32Array | number[]> = {
  segments: T[];
  segmentIndexedMeshes: { vertices: T; triangles: Uint32Array }[];
  diagnostics: CandidateDiagnostics;
};
type SingleMeshResult = {
  mesh: {
    positions: number[];
    indexedMesh: { vertices: number[]; triangles: Uint32Array };
  };
  diagnostics: CandidateDiagnostics;
};
type CandidateSource = {
  vertices: Float32Array | Float64Array | number[];
  triangles: Uint32Array;
};

export function runFiniteSplitCandidate(
  positions: Float32Array | Float64Array | number[],
  cutter: Float32Array | Float64Array | number[],
  indexed: CandidateSource | undefined,
  options: CandidateOptions & {
    preciseCoordinates: true;
    outputMode: "single-mesh";
  },
): SingleMeshResult;
export function runFiniteSplitCandidate(
  positions: Float32Array | Float64Array | number[],
  cutter: Float32Array | Float64Array | number[],
  indexed: CandidateSource | undefined,
  options: CandidateOptions & {
    preciseCoordinates: true;
    outputMode?: "parts";
  },
): CandidateResult<number[]>;
export function runFiniteSplitCandidate(
  positions: Float32Array,
  cutter: Float32Array,
  indexed?: CandidateSource,
  options?: CandidateOptions & {
    preciseCoordinates?: false;
    outputMode?: "parts";
  },
): CandidateResult<Float32Array>;
/** The parts mode groups connected geometry; native classification is unverified. */
export function runFiniteSplitCandidate(
  positions: Float32Array | Float64Array | number[],
  cutter: Float32Array | Float64Array | number[],
  indexed?: CandidateSource,
  options: CandidateOptions = {},
): CandidateResult<Float32Array | number[]> | SingleMeshResult {
  if (options.outputMode === "single-mesh" && !options.preciseCoordinates)
    throw new Error("Single-mesh Split requires precise coordinates.");
  const corners = positions.length / 3;
  const limit =
    options.maxWork ??
    4_000_000 +
      corners * (180 + 30 * Math.ceil(Math.log2(Math.max(2, corners)))) +
      cutter.length * 128;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Finite split work budget is invalid.");
  let work = 0;
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    if (++work > limit) throw new Error("Finite split work budget exceeded.");
  };
  const progress = (fraction: number, stage: string) => {
    check();
    options.onProgress?.(fraction, stage);
    check();
  };
  check();
  const refinementOptions = {
    signal: options.signal,
    selection: options.selection,
    tolerance: options.tolerance,
    maxTypedBytes: options.maxTypedBytesPerStage,
    check,
    onProgress: (fraction: number, stage: string) =>
      progress(fraction * 0.65, stage),
  };
  if (!options.preciseCoordinates && !(positions instanceof Float32Array))
    throw new Error(
      "Finite split requires Float32 positions unless precise coordinates are enabled.",
    );
  const refined = options.preciseCoordinates
    ? refineFiniteCutterFromSource(positions, cutter, indexed, undefined, {
        ...refinementOptions,
        preciseCoordinates: true,
      })
    : refineFiniteCutterFromSource(
        positions as Float32Array,
        cutter,
        indexed,
        undefined,
        refinementOptions,
      );
  progress(0.68, "Preparing indexed seam");
  const vertexCopyBytes =
    (refined.sourceVertices.length + refined.addedVertices.length) *
    (options.preciseCoordinates
      ? Float64Array.BYTES_PER_ELEMENT
      : Float32Array.BYTES_PER_ELEMENT);
  const allowance = options.maxTypedBytesPerStage ?? Number.MAX_SAFE_INTEGER;
  if (
    !Number.isSafeInteger(vertexCopyBytes) ||
    !Number.isSafeInteger(allowance) ||
    allowance < 0 ||
    vertexCopyBytes > allowance
  )
    throw new Error(
      "Finite split source vertex copy typed memory budget exceeded.",
    );
  const vertices = options.preciseCoordinates
    ? new Float64Array(
        refined.sourceVertices.length + refined.addedVertices.length,
      )
    : new Float32Array(
        refined.sourceVertices.length + refined.addedVertices.length,
      );
  vertices.set(refined.sourceVertices);
  vertices.set(refined.addedVertices, refined.sourceVertices.length);
  const seamOptions = {
    signal: options.signal,
    maxTypedBytes: options.maxTypedBytesPerStage,
    check,
    retainFaceParents:
      !!options.selection && options.outputMode !== "single-mesh",
  };
  const seamed = options.preciseCoordinates
    ? materializeFiniteSeams(vertices, refined.triangles, refined.constraints, {
        ...seamOptions,
        preciseCoordinates: true,
      })
    : materializeFiniteSeams(
        vertices as Float32Array,
        refined.triangles,
        refined.constraints,
        seamOptions,
      );
  progress(0.8, "Grouping indexed parts");
  let partition: Uint8Array | undefined;
  if (options.selection && options.outputMode !== "single-mesh") {
    const refinedSelection = new Uint8Array(refined.triangles.length / 3);
    for (let face = 0; face < options.selection.length; face++) {
      check();
      refinedSelection.fill(
        options.selection[face],
        refined.faceOffsets[face],
        refined.faceOffsets[face + 1],
      );
    }
    partition = new Uint8Array(seamed.faceParents!.length);
    for (let face = 0; face < partition.length; face++) {
      check();
      partition[face] = refinedSelection[seamed.faceParents![face]];
    }
  }
  const groups = groupFiniteTrianglesCompact(
    seamed.triangles,
    new Uint32Array(),
    {
      signal: options.signal,
      maxTypedBytes: options.maxTypedBytesPerStage,
      check,
      partition: options.outputMode === "single-mesh" ? undefined : partition,
    },
  );
  if (options.outputMode === "single-mesh") {
    const bytes = seamed.triangles.length * 3 * 8;
    if (!Number.isSafeInteger(bytes) || bytes > allowance)
      throw new Error("Finite single-mesh output memory budget exceeded.");
    const positions = new Array<number>(seamed.triangles.length * 3);
    for (let corner = 0; corner < seamed.triangles.length; corner++) {
      if ((corner & 4095) === 0) check();
      const vertex = seamed.triangles[corner] * 3;
      for (let axis = 0; axis < 3; axis++)
        positions[corner * 3 + axis] = seamed.vertices[vertex + axis];
    }
    let count = 0;
    for (let face = 0; face < groups.length; face++) {
      if ((face & 4095) === 0) check();
      if (groups[face] === face) count++;
    }
    progress(1, "Finite split candidate complete");
    return {
      mesh: {
        positions,
        indexedMesh: {
          vertices: seamed.vertices as number[],
          triangles: seamed.triangles,
        },
      },
      diagnostics: {
        affectedFaces: refined.affectedFaces,
        sourceFaces: refined.sourceFaces,
        parts: count,
        cutEdges: refined.constraints.length / 2,
        sourceIdentity: refined.sourceIdentity,
      },
    };
  }
  progress(0.9, "Preparing indexed parts");
  const parts = partitionFiniteIndexedParts(
    seamed.vertices,
    seamed.triangles,
    groups,
    {
      signal: options.signal,
      maxTypedBytes: options.maxTypedBytesPerStage,
      check,
    },
  );
  progress(1, "Finite split candidate complete");
  return {
    segments: parts.map((part) => part.positions),
    segmentIndexedMeshes: parts.map((part) => part.indexedMesh),
    diagnostics: {
      affectedFaces: refined.affectedFaces,
      sourceFaces: refined.sourceFaces,
      parts: parts.length,
      cutEdges: refined.constraints.length / 2,
      sourceIdentity: refined.sourceIdentity,
    },
  };
}
