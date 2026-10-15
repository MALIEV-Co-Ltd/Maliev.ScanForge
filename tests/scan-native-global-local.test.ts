import { expect, it } from "vitest";
import fixture from "./fixtures/global-fine-local-native.json";
import { nativeGlobalRefineLocal } from "../src/scan-native-global-local";
const bits = (v: readonly number[]) =>
  Buffer.from(Float64Array.from(v).buffer).toString("hex");
it.each(fixture.cases)(
  "matches original global local iterations and rollback: $name",
  async (c) => {
    let index = 0;
    const controller = new AbortController();
    if (c.cancelInitially) controller.abort();
    const result = await nativeGlobalRefineLocal(
      {
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
        mean: Buffer.from(c.entryMeanBits, "hex").readDoubleLE(),
        std: 20,
      },
      (matrix) => {
        const q = c.queries[index++];
        expect(q).toBeDefined();
        expect(bits(matrix)).toBe(q.matrixBits);
        if (c.cancelAfterQuery === index) controller.abort();
        return {
          count: q.count,
          pairs: q.pairs,
        };
      },
      { signal: controller.signal },
    );
    expect(index).toBe(c.queries.length);
    expect(result.status).toBe(c.status);
    expect(bits(result.matrix)).toBe(c.matrixBits);
    expect(bits([result.mean])).toBe(c.meanBits);
    expect(bits([result.std])).toBe(c.stdBits);
    expect(result.converged).toBe(c.converged);
    expect(result.stable).toBe(c.stable);
  },
);
