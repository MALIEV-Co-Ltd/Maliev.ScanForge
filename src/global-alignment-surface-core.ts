import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { MeshBVH, SAH } from "three-mesh-bvh";
import {
  compose,
  identityTransform,
  registerPairedPoints,
  transformPoint,
  type RigidTransform,
  validateTransform,
} from "./registration";
import type {
  GlobalInitializationFit,
  GlobalInitializationScan,
} from "./global-alignment-initialization-core";
export interface GlobalSurfaceMesh {
  id: string;
  vertices: Float32Array;
  triangles: Uint32Array;
}
const matrix = (t: RigidTransform) => [
  t.rotation[0],
  t.rotation[1],
  t.rotation[2],
  t.translation[0],
  t.rotation[3],
  t.rotation[4],
  t.rotation[5],
  t.translation[1],
  t.rotation[6],
  t.rotation[7],
  t.rotation[8],
  t.translation[2],
];
const inversePoint = (
  p: number[],
  t: RigidTransform,
): [number, number, number] => {
  const a = p.map((v, i) => v - t.translation[i]),
    r = t.rotation;
  return [
    r[0] * a[0] + r[3] * a[1] + r[6] * a[2],
    r[1] * a[0] + r[4] * a[1] + r[7] * a[2],
    r[2] * a[0] + r[5] * a[1] + r[8] * a[2],
  ];
};
function solve(a: number[][], b: number[]) {
  const m = a.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < 6; i++) {
    let pivot = i;
    for (let j = i + 1; j < 6; j++)
      if (Math.abs(m[j][i]) > Math.abs(m[pivot][i])) pivot = j;
    if (Math.abs(m[pivot][i]) < 1e-14) return undefined;
    [m[i], m[pivot]] = [m[pivot], m[i]];
    const d = m[i][i];
    for (let k = i; k < 7; k++) m[i][k] /= d;
    for (let j = 0; j < 6; j++)
      if (j !== i) {
        const f = m[j][i];
        for (let k = i; k < 7; k++) m[j][k] -= f * m[i][k];
      }
  }
  return m.map((r) => r[6]);
}
function increment(
  delta: number[],
  center: number[],
  scale: number,
): RigidTransform {
  const w = delta.slice(0, 3).map((v) => v * scale),
    angle = Math.hypot(...w),
    c = Math.cos(angle),
    s = angle ? Math.sin(angle) / angle : 1,
    k = angle ? (1 - c) / (angle * angle) : 0.5,
    [x, y, z] = w;
  const rotation: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ] = [
    c + x * x * k,
    x * y * k - z * s,
    x * z * k + y * s,
    y * x * k + z * s,
    c + y * y * k,
    y * z * k - x * s,
    z * x * k - y * s,
    z * y * k + x * s,
    c + z * z * k,
  ];
  const moved = transformPoint(center as [number, number, number], {
    rotation,
    translation: [0, 0, 0],
  });
  return {
    rotation,
    translation: center.map((v, i) => v - moved[i] + delta[i + 3] * scale) as [
      number,
      number,
      number,
    ],
  };
}
function poseFromMatrix(m: readonly number[]): RigidTransform {
  if (m.length !== 12 || !m.every(Number.isFinite))
    throw Error("Invalid surface seed");
  const t: RigidTransform = {
    rotation: [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]],
    translation: [m[3], m[7], m[11]],
  };
  validateTransform(t);
  return t;
}
/** Bounded fitting samples against complete triangle surfaces; anchored group placement. */
export function refineGlobalSurfaceSamples(
  scans: GlobalInitializationScan[],
  meshes: GlobalSurfaceMesh[],
  onPose?: (poses: GlobalInitializationFit[]) => void,
  distanceLimit = 0.5,
) {
  if (
    scans.length < 2 ||
    scans.length > 32 ||
    meshes.length !== scans.length ||
    new Set(scans.map((s) => s.id)).size !== scans.length
  )
    throw Error("Surface placement requires distinct matching scans.");
  if (
    !Number.isFinite(distanceLimit) ||
    distanceLimit < 0 ||
    new Set(meshes.map((m) => m.id)).size !== scans.length ||
    scans.some(
      (s) =>
        !meshes.some((m) => m.id === s.id) ||
        s.points.length < 9 ||
        s.points.length > 18000 ||
        s.points.length % 3 ||
        (s.candidates?.length ?? 0) > 25 ||
        !s.points.every(Number.isFinite),
    )
  )
    throw Error("Invalid bounded surface fitting inputs.");
  const estimate = meshes.reduce(
    (s, m) =>
      s +
      m.vertices.byteLength +
      m.triangles.byteLength +
      (m.triangles.length / 3) * 64,
    0,
  );
  if (estimate > 512 * 1024 * 1024)
    throw Error(
      "Automatic surface placement exceeds its 512 MiB workspace limit.",
    );
  const fixed: {
      id: string;
      geometry: BufferGeometry;
      tree: MeshBVH;
      pose: RigidTransform;
    }[] = [],
    fits: GlobalInitializationFit[] = scans.map((s) => ({
      id: s.id,
      matrix: matrix(identityTransform()),
      rms: 0,
      ambiguous: false,
    }));
  const add = (id: string, pose: RigidTransform) => {
    const m = meshes.find((m) => m.id === id);
    if (
      !m ||
      m.vertices.length % 3 ||
      m.triangles.length % 3 ||
      !m.triangles.length
    )
      throw Error("Invalid surface placement mesh.");
    if (
      !m.vertices.every(Number.isFinite) ||
      !m.triangles.every((i) => i < m.vertices.length / 3)
    )
      throw Error("Invalid surface coordinates or triangle indices.");
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(m.vertices, 3));
    geometry.setIndex(new BufferAttribute(m.triangles.slice(), 1));
    const tree = new MeshBVH(geometry, { strategy: SAH, targetLeafSize: 10 });
    fixed.push({ id, geometry, tree, pose });
  };
  add(scans[0].id, identityTransform());
  const pending = scans.slice(1),
    order = [scans[0].id];
  const rankSource = (s: GlobalInitializationScan) => {
    const starts = [
        identityTransform(),
        ...(s.candidates ?? []).map(poseFromMatrix),
      ],
      point = new Vector3(),
      hit = { point: new Vector3(), distance: 0, faceIndex: 0 };
    let best = Infinity;
    for (const start of starts) {
      let sum = 0,
        count = 0;
      const stride = Math.max(1, Math.ceil(s.points.length / 3 / 512));
      for (let i = 0; i < s.points.length; i += stride * 3) {
        const world = transformPoint(
          [s.points[i], s.points[i + 1], s.points[i + 2]],
          start,
        );
        let distance = Infinity;
        for (const t of fixed) {
          if (t.id === s.id) continue;
          point.set(...inversePoint(world, t.pose));
          const result = t.tree.closestPointToPoint(point, hit, 0, distance);
          if (result) distance = Math.min(distance, result.distance);
        }
        sum += Math.min(distance ** 2, distanceLimit ** 2);
        count++;
      }
      best = Math.min(best, sum / count);
    }
    return best;
  };
  try {
    for (let scan = 1; scan <= 2 * (scans.length - 1) + 1; scan++) {
      if (scan === 2 * (scans.length - 1) + 1) pending.push(scans[0]);
      else if (!pending.length) pending.push(...scans.slice(1));
      let next = 0,
        bestRank = Infinity;
      for (let i = 0; i < pending.length; i++) {
        const rank = rankSource(pending[i]);
        if (rank < bestRank) {
          bestRank = rank;
          next = i;
        }
      }
      const source = pending.splice(next, 1)[0],
        fitIndex = fits.findIndex((f) => f.id === source.id),
        p = new Vector3(),
        hit = { point: new Vector3(), faceIndex: 0, distance: 0 };
      let pose = identityTransform(),
        iterations = 0,
        converged = false;
      const allPairs = (candidate: RigidTransform, stride = 1) => {
        const out: {
          p: number[];
          q: number[];
          n: number[];
          d: number;
          slot: number;
        }[] = [];
        for (let i = 0; i < source.points.length; i += 3 * stride) {
          const world = transformPoint(
            [source.points[i], source.points[i + 1], source.points[i + 2]],
            candidate,
          );
          let best: (typeof out)[number] | undefined;
          for (const t of fixed) {
            if (t.id === source.id) continue;
            const local = inversePoint(world, t.pose);
            p.set(...local);
            const result = t.tree.closestPointToPoint(
              p,
              hit,
              0,
              best ? Math.sqrt(best.d) : Infinity,
            );
            if (!result) continue;
            const idx = t.geometry.index!.array,
              v = t.geometry.attributes.position.array,
              a = Number(idx[result.faceIndex * 3]) * 3,
              b = Number(idx[result.faceIndex * 3 + 1]) * 3,
              c = Number(idx[result.faceIndex * 3 + 2]) * 3,
              ab = [v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]],
              ac = [v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]],
              normal = [
                ab[1] * ac[2] - ab[2] * ac[1],
                ab[2] * ac[0] - ab[0] * ac[2],
                ab[0] * ac[1] - ab[1] * ac[0],
              ],
              length = Math.hypot(...normal);
            if (!(length > 1e-15)) continue;
            const r = t.pose.rotation,
              n = normal.map((x) => x / length),
              rotated = [
                r[0] * n[0] + r[1] * n[1] + r[2] * n[2],
                r[3] * n[0] + r[4] * n[1] + r[5] * n[2],
                r[6] * n[0] + r[7] * n[1] + r[8] * n[2],
              ];
            best = {
              slot: i / 3,
              p: world,
              q: transformPoint(result.point.toArray(), t.pose),
              n: rotated,
              d: result.distance ** 2,
            };
          }
          if (best) out.push(best);
        }
        if (out.length < 3)
          throw Error("Insufficient surface correspondences.");
        return out;
      };
      const previous = fixed.find((t) => t.id === source.id);
      const reference =
        previous?.pose ??
        (source.candidates?.length
          ? poseFromMatrix(source.candidates.at(-1)!)
          : identityTransform());
      const baseline = allPairs(reference),
        support = new Set(
          baseline.filter((p) => p.d <= distanceLimit ** 2).map((p) => p.slot),
        );
      // Compare all sample IDs with the same capped surface-distance loss.
      // Changing the overlap fraction cannot discard difficult points from this acceptance check.
      const fixedScore = (ps: ReturnType<typeof allPairs>) =>
        Math.sqrt(
          ps.reduce((sum, p) => sum + Math.min(p.d, distanceLimit ** 2), 0) /
            ps.length,
        );
      const beforeRms = fixedScore(baseline);
      let finalPose = reference,
        finalRms = beforeRms,
        finalIterations = 0,
        finalConverged = beforeRms < 1e-7,
        finalTrim = 0.8,
        finalFittingRms = beforeRms;
      const seeds = [
        reference,
        identityTransform(),
        ...(source.candidates ?? []).map(poseFromMatrix),
      ].map((pose, index) => ({ pose, index }));
      const selectedSeeds: typeof seeds = [];
      for (const seed of seeds) {
        if (
          selectedSeeds.every(
            (s) =>
              Math.hypot(
                ...s.pose.translation.map(
                  (v, i) => v - seed.pose.translation[i],
                ),
              ) > 0.05 ||
              Math.hypot(
                ...s.pose.rotation.map((v, i) => v - seed.pose.rotation[i]),
              ) > 0.002,
          )
        )
          selectedSeeds.push(seed);
        if (selectedSeeds.length === 2) break;
      }
      if (
        selectedSeeds.every(
          (seed) =>
            allPairs(seed.pose).filter((p) => p.d <= distanceLimit ** 2)
              .length <
            Math.max(3, Math.ceil((source.points.length / 3) * 0.05)),
        )
      )
        throw Error(
          "Automatic surface fitting needs more overlap within the search tolerance; increase the tolerance or use N-point placement.",
        );
      const seedCosts = new Map<number, number>();
      const seedPoses = new Map<number, RigidTransform>();
      let finalSeed = 0;
      for (const seed of selectedSeeds)
        for (const fraction of [0.8, 0.4]) {
          pose = seed.pose;
          iterations = 0;
          converged = false;
          const pairs = (candidate: RigidTransform) => {
            const out = allPairs(candidate).sort((a, b) => a.d - b.d);
            out.length = Math.max(3, Math.floor(out.length * fraction));
            return out;
          };
          const score = (ps: ReturnType<typeof pairs>) =>
            Math.sqrt(ps.reduce((s, p) => s + p.d, 0) / ps.length);
          let current = pairs(pose),
            rms = score(current);
          for (let iteration = 0; iteration < 40; iteration++) {
            const center = [0, 1, 2].map(
                (a) => current.reduce((s, p) => s + p.p[a], 0) / current.length,
              ),
              a = Array.from({ length: 6 }, () => Array(6).fill(0)),
              b = Array(6).fill(0);
            for (const pair of current) {
              const [x, y, z] = pair.p.map((v, i) => v - center[i]),
                [nx, ny, nz] = pair.n,
                j = [
                  y * nz - z * ny,
                  z * nx - x * nz,
                  x * ny - y * nx,
                  nx,
                  ny,
                  nz,
                ],
                error = pair.n.reduce(
                  (s, n, i) => s + n * (pair.q[i] - pair.p[i]),
                  0,
                );
              for (let r = 0; r < 6; r++) {
                b[r] += j[r] * error;
                for (let c = 0; c < 6; c++) a[r][c] += j[r] * j[c];
              }
            }
            for (let i = 0; i < 6; i++)
              a[i][i] += Math.max(a[i][i] * 1e-7, 1e-8);
            const delta = solve(a, b),
              candidates: RigidTransform[] = [];
            if (delta) {
              const angle = Math.hypot(...delta.slice(0, 3)),
                translation = Math.hypot(...delta.slice(3)),
                limit = Math.min(
                  1,
                  0.15 / (angle || 1),
                  5 / (translation || 1),
                );
              for (const step of [1, 0.5, 0.25])
                candidates.push(
                  compose(increment(delta, center, step * limit), pose),
                );
            }
            const horn = registerPairedPoints(
              current.flatMap((p) => p.p),
              current.flatMap((p) => p.q),
            );
            candidates.push(compose(horn.transform, pose));
            let selected = pose,
              best = current,
              bestRms = rms;
            for (const candidate of candidates) {
              const ps = pairs(candidate),
                value = score(ps);
              if (value < bestRms) {
                best = ps;
                bestRms = value;
                selected = candidate;
              }
            }
            const improvement = rms - bestRms;
            pose = selected;
            current = best;
            rms = bestRms;
            iterations = iteration + 1;
            fits[fitIndex] = {
              ...fits[fitIndex],
              matrix: matrix(pose),
              rms,
              beforeRms,
              iterations,
              converged: false,
            };
            onPose?.(fits.map((f) => ({ ...f, matrix: [...f.matrix] })));
            if (improvement < 1e-7) {
              converged = true;
              break;
            }
          }
          const checked = fixedScore(allPairs(pose));
          if (checked < (seedCosts.get(seed.index) ?? Infinity))
            seedPoses.set(seed.index, pose);
          seedCosts.set(
            seed.index,
            Math.min(checked, seedCosts.get(seed.index) ?? Infinity),
          );
          if (checked < finalRms) {
            finalPose = pose;
            finalRms = checked;
            finalIterations = iterations;
            finalConverged = converged;
            finalTrim = fraction;
            finalFittingRms = rms;
            finalSeed = seed.index;
          }
        }
      pose = finalPose;
      fits[fitIndex] = {
        ...fits[fitIndex],
        matrix: matrix(pose),
        rms: finalRms,
        beforeRms,
        rmsBasis: "cappedSurfaceSamples",
        samplePoints: source.points.length / 3,
        iterations: finalIterations,
        converged: finalConverged,
        trimFraction: finalTrim,
        initialOverlapPoints: support.size,
        overlapPoints: allPairs(finalPose).filter(
          (p) => p.d <= distanceLimit ** 2,
        ).length,
        fittingRms: finalFittingRms,
        ambiguous: [...seedCosts.entries()].some(
          ([i, cost]) =>
            i !== finalSeed &&
            seedPoses.has(i) &&
            (Math.hypot(
              ...seedPoses
                .get(i)!
                .translation.map((v, a) => v - finalPose.translation[a]),
            ) > 0.05 ||
              Math.hypot(
                ...seedPoses
                  .get(i)!
                  .rotation.map((v, a) => v - finalPose.rotation[a]),
              ) > 0.002) &&
            Math.abs(cost - finalRms) <= Math.max(0.0001, finalRms * 0.02),
        ),
        candidatesTested: seeds.length,
        seedIndex: finalSeed,
      };
      onPose?.(fits.map((f) => ({ ...f, matrix: [...f.matrix] })));
      if (!order.includes(source.id)) order.push(source.id);
      if (previous) previous.pose = pose;
      else add(source.id, pose);
    }
    // Resolve the anchored scan against the completed group too, then restore
    // its coordinate frame. This avoids freezing a poor first pair forever.
    const anchorPose = poseFromMatrix(fits[0].matrix),
      r = anchorPose.rotation;
    const inverse: RigidTransform = {
      rotation: [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]],
      translation: inversePoint([0, 0, 0], anchorPose),
    };
    for (let i = 1; i < fits.length; i++)
      fits[i] = {
        ...fits[i],
        matrix: matrix(compose(inverse, poseFromMatrix(fits[i].matrix))),
      };
    fits[0] = {
      id: scans[0].id,
      matrix: matrix(identityTransform()),
      rms: 0,
      ambiguous: false,
    };
    onPose?.(fits.map((f) => ({ ...f, matrix: [...f.matrix] })));
    return { anchorId: scans[0].id, fits, order };
  } finally {
    for (const t of fixed) t.geometry.dispose();
  }
}
