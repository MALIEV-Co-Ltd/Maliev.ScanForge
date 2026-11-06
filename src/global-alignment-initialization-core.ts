import {
  identityTransform,
  registerGlobal,
  type RegistrationResult,
} from "./registration";
export type GlobalInitializationScan = {
  id: string;
  points: Float32Array;
  candidates?: number[][];
};
export type GlobalInitializationFit = {
  id: string;
  matrix: number[];
  rms: number;
  ambiguous: boolean;
  beforeRms?: number;
  samplePoints?: number;
  rmsBasis?: "cappedSurfaceSamples";
  candidatesTested?: number;
  seedIndex?: number;
  trimFraction?: number;
  overlapPoints?: number;
  initialOverlapPoints?: number;
  fittingRms?: number;
  iterations?: number;
  converged?: boolean;
};
export function initializeGlobalSamples(
  scans: readonly GlobalInitializationScan[],
  onPose?: (poses: GlobalInitializationFit[]) => void,
) {
  if (
    scans.length < 2 ||
    scans.length > 32 ||
    new Set(scans.map((s) => s.id)).size !== scans.length ||
    scans.some(
      (s) =>
        !s.id ||
        s.points.length < 9 ||
        s.points.length > 18000 ||
        s.points.length % 3,
    )
  )
    throw Error(
      "Automatic placement requires 2–32 distinct bounded scan samples.",
    );
  const anchor = scans[0];
  const fits: GlobalInitializationFit[] = scans.map((s) => ({
    id: s.id,
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    rms: 0,
    ambiguous: false,
  }));
  for (let i = 1; i < scans.length; i++) {
    const fit: RegistrationResult = registerGlobal(
      scans[i].points,
      anchor.points,
      {
        coarseSampleSize: 1500,
        sampleSize: 3000,
        targetSampleSize: 6000,
        maxIterations: 60,
        refinementCandidates: 12,
        trimFraction: 0.6,
        initial: identityTransform(),
      },
    );
    const r = fit.transform.rotation,
      t = fit.transform.translation;
    fits[i] = {
      id: scans[i].id,
      matrix: [
        r[0],
        r[1],
        r[2],
        t[0],
        r[3],
        r[4],
        r[5],
        t[1],
        r[6],
        r[7],
        r[8],
        t[2],
      ],
      rms: fit.rms,
      ambiguous: !!fit.principalAxesAmbiguous,
    };
    onPose?.(
      fits.map((f) => ({
        ...f,
        matrix: [...f.matrix],
      })),
    );
  }
  return { anchorId: anchor.id, fits };
}
