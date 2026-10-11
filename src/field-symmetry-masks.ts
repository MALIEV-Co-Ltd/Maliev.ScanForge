import type { FieldExclusionBits } from "./field-candidate-lists";
import type { SymmetryTopology } from "./field-symmetry-topology";

export interface FieldSymmetryMasks {
  faces: FieldExclusionBits;
  vertices: FieldExclusionBits;
  maskedFaceCount: number;
  enabled: boolean;
}

/** Prepare curvature-stage masks from an already computed symmetry cache. */
export function prepareFieldSymmetryMasks(
  topology: Pick<SymmetryTopology, "faceStatus" | "mappedFaceCount">,
  vertexPartners: Int32Array,
  positiveSide: FieldExclusionBits,
  options: {
    mode: number;
    requireComplete: boolean;
    previousVertices?: FieldExclusionBits;
  },
): FieldSymmetryMasks {
  const faceCount = topology.faceStatus.length;
  const vertexCount = vertexPartners.length;
  const validateMask = (mask: FieldExclusionBits) => {
    if (
      !Number.isInteger(mask.bitCount) ||
      mask.bitCount < 0 ||
      mask.bitCount > 2147483647 ||
      mask.bits.length * 8 < mask.bitCount
    )
      throw new Error("Symmetry mask dimensions are inconsistent.");
  };
  validateMask(positiveSide);
  if (positiveSide.bitCount > vertexCount)
    throw new Error("Symmetry side mask exceeds the vertex count.");
  if (options.previousVertices) validateMask(options.previousVertices);
  if (
    !Number.isInteger(options.mode) ||
    options.mode < -2147483648 ||
    options.mode > 2147483647 ||
    !Number.isInteger(topology.mappedFaceCount) ||
    topology.mappedFaceCount < 0 ||
    topology.mappedFaceCount > 2147483647
  )
    throw new Error("Invalid symmetry preparation state.");
  for (const status of topology.faceStatus)
    if (status < -1 || status > 2)
      throw new Error("Invalid symmetry face status.");
  for (const partner of vertexPartners)
    if (partner < -1 || partner >= vertexCount)
      throw new Error("Symmetry mapping references an invalid vertex.");

  const faces = {
    bits: new Uint8Array(Math.ceil(faceCount / 8)),
    bitCount: faceCount,
  };
  const enabled =
    (options.mode === 1 || options.mode === 2) &&
    (!options.requireComplete || topology.mappedFaceCount === faceCount);
  if (!enabled) {
    const previous = options.previousVertices;
    return {
      faces,
      vertices: previous
        ? { bits: previous.bits.slice(), bitCount: previous.bitCount }
        : { bits: new Uint8Array(), bitCount: 0 },
      maskedFaceCount: 0,
      enabled,
    };
  }

  let maskedFaceCount = 0;
  for (let face = 0; face < faceCount; face++)
    if (topology.faceStatus[face] === 0) {
      faces.bits[face >> 3] |= 1 << (face & 7);
      maskedFaceCount++;
    }
  const vertices = {
    bits: new Uint8Array(Math.ceil(vertexCount / 8)),
    bitCount: vertexCount,
  };
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const masked =
      vertex < positiveSide.bitCount &&
      (positiveSide.bits[vertex >> 3] & (1 << (vertex & 7))) !== 0;
    const partner = vertexPartners[vertex];
    if (!masked && partner !== -1 && partner !== vertex)
      vertices.bits[vertex >> 3] |= 1 << (vertex & 7);
  }
  return { faces, vertices, maskedFaceCount, enabled };
}
