import type { Positions } from "./types";
export type GridProgress = (fraction: number, stage: string) => void;
/** One bit per lattice point, with all allocations bounded by the grid admission. */
export class GridBits {
  readonly words: Uint32Array;
  constructor(readonly length: number) {
    this.words = new Uint32Array(Math.ceil(length / 32));
  }
  get(i: number) {
    return (this.words[i >>> 5] >>> (i & 31)) & 1;
  }
  set(i: number) {
    this.words[i >>> 5] |= 1 << (i & 31);
  }
}
function segmentDistance(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
) {
  const x = bx - ax,
    y = by - ay,
    z = bz - az,
    denominator = x * x + y * y + z * z;
  const t = denominator
    ? Math.max(
        0,
        Math.min(
          1,
          ((px - ax) * x + (py - ay) * y + (pz - az) * z) / denominator,
        ),
      )
    : 0;
  return (
    (px - ax - t * x) ** 2 + (py - ay - t * y) ** 2 + (pz - az - t * z) ** 2
  );
}
/** Squared Euclidean distance; degenerate scan facets contribute their segments. */
export function triangleDistanceSquared(
  px: number,
  py: number,
  pz: number,
  a: ArrayLike<number>,
  i: number,
) {
  const ax = a[i],
    ay = a[i + 1],
    az = a[i + 2],
    bx = a[i + 3],
    by = a[i + 4],
    bz = a[i + 5],
    cx = a[i + 6],
    cy = a[i + 7],
    cz = a[i + 8];
  const ux = bx - ax,
    uy = by - ay,
    uz = bz - az,
    vx = cx - ax,
    vy = cy - ay,
    vz = cz - az;
  const nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx;
  if (nx * nx + ny * ny + nz * nz === 0)
    return Math.min(
      segmentDistance(px, py, pz, ax, ay, az, bx, by, bz),
      segmentDistance(px, py, pz, bx, by, bz, cx, cy, cz),
      segmentDistance(px, py, pz, cx, cy, cz, ax, ay, az),
    );
  const qx = px - ax,
    qy = py - ay,
    qz = pz - az,
    d1 = ux * qx + uy * qy + uz * qz,
    d2 = vx * qx + vy * qy + vz * qz;
  if (d1 <= 0 && d2 <= 0) return qx * qx + qy * qy + qz * qz;
  const rx = px - bx,
    ry = py - by,
    rz = pz - bz,
    d3 = ux * rx + uy * ry + uz * rz,
    d4 = vx * rx + vy * ry + vz * rz;
  if (d3 >= 0 && d4 <= d3) return rx * rx + ry * ry + rz * rz;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    return (qx - t * ux) ** 2 + (qy - t * uy) ** 2 + (qz - t * uz) ** 2;
  }
  const sx = px - cx,
    sy = py - cy,
    sz = pz - cz,
    d5 = ux * sx + uy * sy + uz * sz,
    d6 = vx * sx + vy * sy + vz * sz;
  if (d6 >= 0 && d5 <= d6) return sx * sx + sy * sy + sz * sz;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    return (qx - t * vx) ** 2 + (qy - t * vy) ** 2 + (qz - t * vz) ** 2;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return (
      (rx - t * (cx - bx)) ** 2 +
      (ry - t * (cy - by)) ** 2 +
      (rz - t * (cz - bz)) ** 2
    );
  }
  const f = 1 / (va + vb + vc),
    v = vb * f,
    w = vc * f;
  return (
    (qx - v * ux - w * vx) ** 2 +
    (qy - v * uy - w * vy) ** 2 +
    (qz - v * uz - w * vz) ** 2
  );
}
/** Rasterize only the finite expanded triangle boxes, never query empty volume. */
export function sampleReconstructionGrid(
  inputs: Positions[],
  start: number[],
  dimensions: number[],
  resolution: number,
  progress: GridProgress,
) {
  const [nx, ny, nz] = dimensions,
    slice = nx * ny,
    total = slice * nz,
    bits = new GridBits(total),
    radius = resolution * 0.75,
    r2 = radius * radius;
  let candidates = 0,
    distanceTests = 0,
    shellPoints = 0,
    processed = 0;
  const coordinates = inputs.reduce((n, p) => n + p.length, 0);
  for (const p of inputs)
    for (let i = 0; i < p.length; i += 9) {
      if (i % 9216 === 0)
        progress(
          0.05 + (0.55 * processed) / coordinates,
          "Sampling surface distance",
        );
      const low = [0, 1, 2].map((k) =>
        Math.max(
          0,
          Math.ceil(
            (Math.min(p[i + k], p[i + 3 + k], p[i + 6 + k]) -
              radius -
              start[k]) /
              resolution,
          ),
        ),
      );
      const high = [0, 1, 2].map((k) =>
        Math.min(
          dimensions[k] - 1,
          Math.floor(
            (Math.max(p[i + k], p[i + 3 + k], p[i + 6 + k]) +
              radius -
              start[k]) /
              resolution,
          ),
        ),
      );
      for (let z = low[2]; z <= high[2]; z++)
        for (let y = low[1]; y <= high[1]; y++)
          for (let x = low[0]; x <= high[0]; x++) {
            if (++candidates % 65536 === 0)
              progress(
                0.05 + (0.55 * processed) / coordinates,
                "Sampling surface distance",
              );
            if (candidates > 500_000_000)
              throw Error(
                "Reconstruction sampling exceeds its bounded work limit; increase point resolution.",
              );
            const id = x + y * nx + z * slice;
            if (bits.get(id)) continue;
            distanceTests++;
            if (
              triangleDistanceSquared(
                start[0] + x * resolution,
                start[1] + y * resolution,
                start[2] + z * resolution,
                p,
                i,
              ) <= r2
            ) {
              bits.set(id);
              shellPoints++;
            }
          }
      processed += 9;
    }
  return { occupancy: bits, shellPoints, distanceTests, candidates };
}
/** Six-connected exterior fill with a bounded ring of x spans, not one queue item per voxel. */
export function closeReconstructionGrid(
  occupancy: GridBits,
  dimensions: number[],
  progress: GridProgress,
) {
  const [nx, ny, nz] = dimensions,
    slice = nx * ny,
    total = slice * nz,
    outside = new GridBits(total);
  let queue = new Uint32Array(131072),
    head = 0,
    tail = 0,
    pending = 0,
    visited = 0;
  const push = (a: number, b: number) => {
    if (pending === queue.length) {
      if (queue.length === 2_097_152)
        throw Error(
          "Reconstruction exterior frontier exceeds its bounded memory limit; increase point resolution.",
        );
      const next = new Uint32Array(queue.length * 2);
      for (let i = 0; i < pending; i++)
        next[i] = queue[(head + i) % queue.length];
      queue = next;
      head = 0;
      tail = pending;
    }
    queue[tail] = a;
    queue[(tail + 1) % queue.length] = b;
    tail = (tail + 2) % queue.length;
    pending += 2;
  };
  const visit = (id: number) => {
    if (occupancy.get(id) || outside.get(id)) return;
    const row = id - (id % nx);
    let a = id,
      b = id;
    while (a > row && !occupancy.get(a - 1) && !outside.get(a - 1)) a--;
    while (b < row + nx - 1 && !occupancy.get(b + 1) && !outside.get(b + 1))
      b++;
    for (let p = a; p <= b; p++) {
      outside.set(p);
      if (++visited % 65536 === 0)
        progress(0.6 + (0.09 * visited) / total, "Flooding exterior");
    }
    push(a, b);
  };
  const drain = () => {
    while (pending) {
      const a = queue[head],
        b = queue[(head + 1) % queue.length];
      head = (head + 2) % queue.length;
      pending -= 2;
      const y = Math.floor(a / nx) % ny,
        z = Math.floor(a / slice);
      for (let i = a; i <= b; i++) {
        if (y > 0) visit(i - nx);
        if (y < ny - 1) visit(i + nx);
        if (z > 0) visit(i - slice);
        if (z < nz - 1) visit(i + slice);
      }
    }
  };
  // Padding is exterior-connected. Drain from one corner before sweeping the
  // remaining boundary seeds, avoiding a queue entry for every boundary row.
  visit(0);
  drain();
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++) {
      visit(y * nx + z * slice);
      visit(nx - 1 + y * nx + z * slice);
    }
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) {
      visit(x + z * slice);
      visit(x + (ny - 1) * nx + z * slice);
    }
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      visit(x + y * nx);
      visit(x + y * nx + (nz - 1) * slice);
    }
  drain();
  let filled = 0;
  for (let i = 0; i < occupancy.words.length; i++) {
    if (i % 2048 === 0)
      progress(
        0.69 + (0.01 * i) / occupancy.words.length,
        "Closing enclosed holes and fusing regions",
      );
    const valid =
      i === occupancy.words.length - 1 && total & 31
        ? 0xffffffff >>> (32 - (total & 31))
        : 0xffffffff;
    let added = (~outside.words[i] & ~occupancy.words[i] & valid) >>> 0;
    occupancy.words[i] |= added;
    added -= (added >>> 1) & 0x55555555;
    added = (added & 0x33333333) + ((added >>> 2) & 0x33333333);
    filled += (((added + (added >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return filled;
}
