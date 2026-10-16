import { expect, it } from "vitest";
import { cubeContours, cubeCorners } from "../src/scan-reconstruction-cubes";
import { analyzeMesh, sheetSummary } from "../src/mesh-processing";
it("all 256 corner patterns conform across faces and form independently verified closed surfaces", () => {
  for (let pattern = 1; pattern < 256; pattern++) {
    const occupancy = new Uint8Array(64);
    cubeCorners.forEach(([x, y, z], k) => {
      if (pattern & (1 << k)) occupancy[x + 1 + (y + 1) * 4 + (z + 1) * 16] = 1;
    });
    const output: number[] = [];
    for (let z = 0; z < 3; z++)
      for (let y = 0; y < 3; y++)
        for (let x = 0; x < 3; x++) {
          let mask = 0;
          cubeCorners.forEach(([dx, dy, dz], k) => {
            mask |= occupancy[x + dx + (y + dy) * 4 + (z + dz) * 16] << k;
          });
          const template = cubeContours[mask];
          for (const tri of template.triangles)
            for (const v of tri) {
              const p = template.points[v];
              output.push(x + p[0], y + p[1], z + p[2]);
            }
        }
    const p = Float32Array.from(output),
      summary = sheetSummary(analyzeMesh(p));
    expect(
      summary.watertight,
      `pattern ${pattern}: ${JSON.stringify(summary)}`,
    ).toBe(true);
    let volume = 0;
    for (let i = 0; i < p.length; i += 9)
      volume +=
        p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) +
        p[i + 1] * (p[i + 5] * p[i + 6] - p[i + 3] * p[i + 8]) +
        p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6]);
    expect(volume).toBeGreaterThan(0);
  }
});
it("neighboring cells conform for all 4096 shared-face configurations in each axis", () => {
  for (let axis = 0; axis < 3; axis++)
    for (let pattern = 1; pattern < 4096; pattern++) {
      const dims = [4, 4, 4];
      dims[axis] = 5;
      const total = dims[0] * dims[1] * dims[2],
        occupied = new Uint8Array(total),
        positions: number[] = [];
      let bit = 0;
      for (let z = 1; z < dims[2] - 1; z++)
        for (let y = 1; y < dims[1] - 1; y++)
          for (let x = 1; x < dims[0] - 1; x++) {
            if (pattern & (1 << bit))
              occupied[x + y * dims[0] + z * dims[0] * dims[1]] = 1;
            bit++;
          }
      for (let z = 0; z < dims[2] - 1; z++)
        for (let y = 0; y < dims[1] - 1; y++)
          for (let x = 0; x < dims[0] - 1; x++) {
            let mask = 0;
            cubeCorners.forEach(([dx, dy, dz], k) => {
              mask |=
                occupied[
                  x + dx + (y + dy) * dims[0] + (z + dz) * dims[0] * dims[1]
                ] << k;
            });
            const template = cubeContours[mask];
            for (const tri of template.triangles)
              for (const id of tri) {
                const p = template.points[id];
                positions.push(x + p[0], y + p[1], z + p[2]);
              }
          }
      const summary = sheetSummary(analyzeMesh(Float32Array.from(positions)));
      expect(
        summary.watertight,
        `axis ${axis}, pattern ${pattern}: ${JSON.stringify(summary)}`,
      ).toBe(true);
    }
}, 60000);
