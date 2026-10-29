import { reductionCandidate } from "./scan-reduction-candidate";
import { CompactReductionState } from "./scan-reduction-storage";

/** Same arithmetic and traversal as the recovered preparer, with flat records. */
export function prepareCompactReduction(
  coordinates: ArrayLike<number>,
  triangles: ArrayLike<number>,
  checkpoint?: () => void,
  limitBytes?: number,
) {
  const state = new CompactReductionState(
    coordinates,
    triangles,
    checkpoint,
    limitBytes,
  );
  let work = 0;
  const check = () => {
    if (work++ % 4096 === 0) checkpoint?.();
  };
  try {
    const {
      points,
      quadrics,
      normals,
      errors,
      best,
      counts,
      offsets,
      references,
    } = state;
    for (let face = 0; face < state.originalFaces; face++) {
      check();
      const corner = face * 3;
      const ids = [
        state.triangles[corner],
        state.triangles[corner + 1],
        state.triangles[corner + 2],
      ];
      const a = ids[0] * 3,
        b = ids[1] * 3,
        c = ids[2] * 3;
      const ux = points[b] - points[a],
        uy = points[b + 1] - points[a + 1],
        uz = points[b + 2] - points[a + 2];
      const vx = points[c] - points[a],
        vy = points[c + 1] - points[a + 1],
        vz = points[c + 2] - points[a + 2];
      let nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (length >= Number.EPSILON) {
        const reciprocal = 1 / length;
        nx *= reciprocal;
        ny *= reciprocal;
        nz *= reciprocal;
      }
      normals[corner] = nx;
      normals[corner + 1] = ny;
      normals[corner + 2] = nz;
      const d = -(points[a + 1] * ny + nx * points[a] + points[a + 2] * nz);
      const quadric = [
        nx * nx,
        nx * ny,
        nx * nz,
        nx * d,
        ny * ny,
        ny * nz,
        ny * d,
        nz * nz,
        nz * d,
        d * d,
      ];
      for (const id of ids)
        for (let entry = 0; entry < 10; entry++)
          quadrics[id * 10 + entry] =
            quadric[entry] + quadrics[id * 10 + entry];
    }
    for (let face = 0; face < state.originalFaces; face++) {
      check();
      const corner = face * 3;
      const a = state.triangles[corner],
        b = state.triangles[corner + 1],
        c = state.triangles[corner + 2];
      const e0 = reductionCandidate(state.vertex(a), state.vertex(b)).cost;
      const e1 = reductionCandidate(state.vertex(b), state.vertex(c)).cost;
      const e2 = reductionCandidate(state.vertex(c), state.vertex(a)).cost;
      errors[corner] = e0;
      errors[corner + 1] = e1;
      errors[corner + 2] = e2;
      best[face] = e1 <= e0 ? (e2 <= e1 ? 2 : 1) : e2 <= e0 ? 2 : 0;
      if (errors[corner + best[face]] < state.minimum)
        state.minimum = errors[corner + best[face]];
      counts[a]++;
      counts[b]++;
      counts[c]++;
    }
    let offset = 0;
    for (let vertex = 0; vertex < state.vertexCount; vertex++) {
      check();
      offsets[vertex] = offset;
      offset += counts[vertex];
      counts[vertex] = 0;
    }
    references.resize(state.triangles.length, checkpoint);
    for (let face = 0; face < state.originalFaces; face++) {
      check();
      for (let corner = 0; corner < 3; corner++) {
        const vertex = state.triangles[face * 3 + corner];
        references.set(offsets[vertex] + counts[vertex]++, face * 3 + corner);
      }
    }
    // Reuse bounded numeric scratch instead of a high-valence Map per vertex.
    const occurrences = new Uint32Array(state.vertexCount);
    const touched = new Uint32Array(state.vertexCount);
    for (let vertex = 0; vertex < state.vertexCount; vertex++) {
      check();
      let touchedCount = 0;
      for (
        let entry = offsets[vertex];
        entry < offsets[vertex] + counts[vertex];
        entry++
      ) {
        check();
        const face = Math.floor(references.get(entry) / 3);
        for (let corner = 0; corner < 3; corner++) {
          const id = state.triangles[face * 3 + corner];
          if (!occurrences[id]) touched[touchedCount++] = id;
          occurrences[id]++;
        }
      }
      for (let index = 0; index < touchedCount; index++) {
        check();
        const id = touched[index];
        if (occurrences[id] === 1) state.boundary[id] = 1;
        occurrences[id] = 0;
      }
    }
    checkpoint?.();
    return state;
  } catch (error) {
    state.dispose();
    throw error;
  }
}
