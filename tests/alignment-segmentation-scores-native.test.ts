import { expect, it } from "vitest";
import native from "./fixtures/alignment-segmentation-scores-native.json";

const sentinel = 3.4028234663852886e38;
it.each(native.cases)(
  "matches complete original score preparation for normals at $angles",
  (sample) => {
    let scores = sample.normals.map(() => sentinel);
    for (const face of sample.triangles)
      for (const [a, b] of [
        [face[1], face[0]],
        [face[2], face[1]],
        [face[2], face[0]],
      ]) {
        const x = sample.normals[a],
          y = sample.normals[b];
        const dot = x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
        scores[a] = Math.min(scores[a], dot);
        scores[b] = Math.min(scores[b], dot);
      }
    scores = scores.map((value) => {
      if (value === sentinel) return value;
      const angle = Math.acos(Math.max(-1, Math.min(1, value)));
      return angle > sample.capDegrees * 0.017453292519943295
        ? sentinel
        : angle;
    });
    const finite = scores.filter((value) => Math.abs(value) !== sentinel);
    const min = finite.length ? Math.min(...finite) : sentinel;
    const max = finite.length ? Math.max(...finite) : -sentinel;
    const magnitude = min < 0 && max > 0 ? Math.max(max, -min) : max;
    // Original normalization clamps before its sentinel check, including capped vertices.
    scores = scores.map((value) => Math.max(min, Math.min(max, value)));
    if (magnitude >= 2 ** -23)
      scores = scores.map((value) =>
        Math.abs(value) === sentinel ? value : value * (1 / magnitude),
      );
    const sums = scores.map(() => 0),
      counts = scores.map(() => 0);
    for (const face of sample.triangles)
      for (let j = 0; j < 3; j++)
        for (const k of [(j + 1) % 3, (j + 2) % 3]) {
          const value = scores[face[k]];
          if (Math.abs(value) === sentinel) continue;
          sums[face[j]] += value;
          counts[face[j]]++;
        }
    scores = scores.map((value, i) =>
      counts[i] ? sums[i] / counts[i] : value,
    );
    expect(
      scores.map((value) => {
        const bytes = Buffer.alloc(8);
        bytes.writeDoubleLE(value);
        return bytes.toString("hex");
      }),
    ).toEqual(sample.nativeScoreBits);
    const labels = Array<number>(sample.triangles.length).fill(0xffffffff);
    const regions: number[][] = [];
    const eligible = (i: number) =>
      !sample.triangles[i].every((v) => sample.threshold < scores[v]);
    for (let start = 0; start < labels.length; start++) {
      if (labels[start] !== 0xffffffff || !eligible(start)) continue;
      const stack = [start],
        region: number[] = [],
        id = regions.length;
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
    expect(labels).toEqual(sample.nativeLabels);
    expect(regions).toEqual(sample.nativeRegions);
  },
);
