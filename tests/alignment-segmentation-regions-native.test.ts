import { expect, it } from "vitest";
import native from "./fixtures/alignment-segmentation-regions-native.json";

it.each(native.cases.map((sample, index) => ({ ...sample, index })))(
  "matches original threshold flags and complete region traversal: $index",
  (sample) => {
    const flags = sample.faceFlags.map(
      (value, i) =>
        (value & ~1) |
        Number(
          sample.faceVertices[i].every(
            (v) => sample.threshold < sample.scores[v],
          ),
        ),
    );
    const vertexFlags = sample.vertexFlags.map((value) => value & ~2);
    sample.faceVertices.forEach((vertices, i) => {
      if (flags[i] & 1) vertices.forEach((v) => (vertexFlags[v] |= 2));
    });
    const labels = Array<number>(flags.length).fill(0xffffffff);
    const regions: number[][] = [];
    const eligible = (i: number) => !(flags[i] & 1) || !!(flags[i] & 2);
    for (let start = 0; start < flags.length; start++) {
      if (labels[start] !== 0xffffffff || !eligible(start)) continue;
      const id = regions.length;
      const stack = [start],
        region: number[] = [];
      labels[start] = (0xff000000 | id) >>> 0;
      while (stack.length) {
        const face = stack.pop()!;
        region.push(face);
        for (const neighbor of sample.neighbors[face]) {
          if (
            neighbor === null ||
            labels[neighbor] !== 0xffffffff ||
            !eligible(neighbor)
          )
            continue;
          labels[neighbor] = (0xff000000 | id) >>> 0;
          stack.push(neighbor);
        }
      }
      regions.push(region);
    }
    expect(sample.native).toEqual({
      labels,
      faceFlags: flags,
      vertexFlags,
      regions,
      maxRegionIndex: Math.max(0, regions.length - 1),
      dirty: 1,
    });
  },
);
