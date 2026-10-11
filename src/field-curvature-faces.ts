import { decomposeCurvatureTensor } from "./field-curvature-eigen";

export interface CurvatureFaceEigenData {
  averages: Float64Array;
  directions: Float32Array;
  middleValues: Float32Array;
  largestValues: Float32Array;
}

/** Adds qualified face bits using supplied native-stage threshold/cache values. */
export function qualifyCurvatureFaces(
  data: CurvatureFaceEigenData,
  normals: Float32Array,
  {
    ratioMinimum,
    magnitudeMinimum = 0,
    radiusMinimum = 0,
    normalDotMaximum,
    helperProximity,
    skippedFaces,
    previousQualified,
  }: {
    ratioMinimum: number;
    magnitudeMinimum?: number;
    radiusMinimum?: number;
    normalDotMaximum: number;
    helperProximity?: Float32Array;
    skippedFaces?: Uint8Array;
    previousQualified?: Uint8Array;
  },
): Uint8Array {
  const faces = data.largestValues.length;
  const bytes = Math.ceil(faces / 8);
  if (
    data.directions.length !== faces * 3 ||
    data.middleValues.length !== faces ||
    normals.length !== faces * 3 ||
    (helperProximity?.length && helperProximity.length !== faces) ||
    (previousQualified && previousQualified.length !== bytes)
  )
    throw new Error("Curvature qualification dimensions are inconsistent.");
  const f = Math.fround;
  const ratioBase = f(ratioMinimum);
  const magnitudeBase = f(magnitudeMinimum);
  const radiusLimit = f(radiusMinimum);
  const normalLimit = f(normalDotMaximum);
  for (const array of [
    data.directions,
    data.middleValues,
    data.largestValues,
    normals,
    helperProximity ?? [],
    [ratioBase, magnitudeBase, radiusLimit, normalLimit],
  ])
    for (const value of array)
      if (!Number.isFinite(value))
        throw new Error("Curvature qualification requires finite data.");
  const qualified = previousQualified?.slice() ?? new Uint8Array(bytes);
  const interpolate = (value: number, lower: number, upper: number) =>
    f(f(f(f(value - 0.5) * f(upper - lower)) / f(1.5 - 0.5)) + lower);
  for (let face = 0; face < faces; face++) {
    if (
      skippedFaces &&
      face < skippedFaces.length * 8 &&
      skippedFaces[face >> 3] & (1 << (face & 7))
    )
      continue;
    const magnitude = Math.abs(data.largestValues[face]);
    const middle = Math.abs(data.middleValues[face]);
    const ratio = magnitude === 0 ? 0 : f(f(magnitude - middle) / magnitude);
    let ratioLimit = ratioBase;
    let magnitudeLimit = magnitudeBase;
    const proximity = helperProximity?.[face];
    if (proximity !== undefined && proximity >= 0.5 && proximity < 1.5) {
      ratioLimit = interpolate(proximity, 1, ratioBase);
      magnitudeLimit = interpolate(
        proximity,
        f(magnitudeBase * 3),
        magnitudeBase,
      );
    }
    if (
      !Number.isFinite(ratio) ||
      !Number.isFinite(ratioLimit) ||
      !Number.isFinite(magnitudeLimit)
    )
      throw new Error(
        "Curvature qualification threshold arithmetic overflowed.",
      );
    if (
      ratio < ratioLimit ||
      magnitude < magnitudeLimit ||
      magnitude < radiusLimit
    )
      continue;
    const base = face * 3;
    const dot = f(
      f(
        f(normals[base + 1] * data.directions[base + 1]) +
          f(normals[base] * data.directions[base]),
      ) + f(normals[base + 2] * data.directions[base + 2]),
    );
    if (!Number.isFinite(dot))
      throw new Error("Curvature normal dot overflowed.");
    if (Math.abs(dot) <= normalLimit) qualified[face >> 3] |= 1 << (face & 7);
  }
  return qualified;
}

/** Recovered ordered face averaging and eigenpair extraction. */
export function deriveCurvatureFaceEigenData(
  triangles: Uint32Array,
  vertexTensors: Float64Array,
  {
    sharpVertices,
    skippedFaces,
    eigenEnabled = true,
    previous,
  }: {
    sharpVertices?: Uint8Array;
    skippedFaces?: Uint8Array;
    eigenEnabled?: boolean;
    previous?: CurvatureFaceEigenData;
  } = {},
): CurvatureFaceEigenData {
  const faces = triangles.length / 3;
  const vertices = vertexTensors.length / 6;
  if (!Number.isInteger(faces) || !Number.isInteger(vertices))
    throw new Error("Curvature face dimensions are inconsistent.");
  for (const vertex of triangles)
    if (vertex >= vertices) throw new Error("Invalid curvature face vertex.");
  for (const value of vertexTensors)
    if (!Number.isFinite(value))
      throw new Error("Curvature face tensors must be finite.");
  if (
    previous &&
    (previous.averages.length !== faces * 6 ||
      previous.directions.length !== faces * 3 ||
      previous.middleValues.length !== faces ||
      previous.largestValues.length !== faces)
  )
    throw new Error("Previous curvature face dimensions are inconsistent.");
  const result: CurvatureFaceEigenData = {
    averages: previous?.averages.slice() ?? new Float64Array(faces * 6),
    directions: previous?.directions.slice() ?? new Float32Array(faces * 3),
    middleValues: previous?.middleValues.slice() ?? new Float32Array(faces),
    largestValues: previous?.largestValues.slice() ?? new Float32Array(faces),
  };
  for (const array of Object.values(result))
    for (const value of array)
      if (!Number.isFinite(value))
        throw new Error("Previous curvature face data must be finite.");
  const marked = (mask: Uint8Array | undefined, id: number) =>
    !!(mask && id < mask.length * 8 && mask[id >> 3] & (1 << (id & 7)));
  const tensor = new Float64Array(6);
  for (let face = 0; face < faces; face++) {
    if (marked(skippedFaces, face)) continue;
    tensor.fill(0);
    let included = 0;
    for (let corner = 0; corner < 3; corner++) {
      const vertex = triangles[face * 3 + corner];
      if (marked(sharpVertices, vertex)) continue;
      for (let lane = 0; lane < 6; lane++) {
        const value = vertexTensors[vertex * 6 + lane];
        tensor[lane] = included === 0 ? value : tensor[lane] + value;
      }
      included++;
    }
    if (included) {
      const reciprocal = 1 / included;
      for (let lane = 0; lane < 6; lane++) tensor[lane] *= reciprocal;
    }
    if (tensor.some((v) => !Number.isFinite(v)))
      throw new Error("Curvature face averaging overflowed.");
    result.averages.set(tensor, face * 6);
    // The recovered worker initializes its eigen output to zero when solving is disabled.
    const pairs = eigenEnabled
      ? decomposeCurvatureTensor(tensor)
      : new Float64Array(12);
    for (let axis = 0; axis < 3; axis++)
      result.directions[face * 3 + axis] = pairs[8 + axis];
    result.middleValues[face] = pairs[7];
    result.largestValues[face] = pairs[11];
    if (
      !Number.isFinite(result.middleValues[face]) ||
      !Number.isFinite(result.largestValues[face])
    )
      throw new Error("Curvature face eigenvalue conversion overflowed.");
  }
  return result;
}
