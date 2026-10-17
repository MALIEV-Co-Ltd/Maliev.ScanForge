/** Measure actual facet-normal discontinuity across the unchanged source rim.
 * Used by the browser replay. Exact Float32 edge
 * identities are intentional; callers verify the expected seam-edge count.
 */
export function holeSeamMetrics(positions, originalLength) {
  const edges = new Map();
  for (let face = 0; face < positions.length; face += 9) {
    const p = [0, 3, 6].map((k) => positions.slice(face + k, face + k + 3));
    const u = p[1].map((v, k) => v - p[0][k]);
    const v = p[2].map((v, k) => v - p[0][k]);
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const length = Math.hypot(...n),
      normal = n.map((v) => v / length);
    const keys = p.map((p) => p.join(","));
    for (let i = 0; i < 3; i++) {
      const a = keys[i],
        b = keys[(i + 1) % 3],
        key = a < b ? `${a}/${b}` : `${b}/${a}`;
      const uses = edges.get(key) ?? [];
      uses.push({ source: face < originalLength, normal });
      edges.set(key, uses);
    }
  }
  const angles = [];
  for (const uses of edges.values()) {
    if (uses.length !== 2 || uses[0].source === uses[1].source) continue;
    const a = uses[0].normal,
      b = uses[1].normal;
    angles.push(
      (Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            a.reduce((s, v, k) => s + v * b[k], 0),
          ),
        ),
      ) *
        180) /
        Math.PI,
    );
  }
  angles.sort((a, b) => a - b);
  return {
    edges: angles.length,
    medianDegrees: angles[Math.floor(angles.length * 0.5)] ?? 0,
    p95Degrees: angles[Math.floor(angles.length * 0.95)] ?? 0,
    maxDegrees: angles.at(-1) ?? 0,
  };
}
