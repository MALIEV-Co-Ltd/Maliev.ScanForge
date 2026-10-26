import { expect, it } from "vitest";
import {
  CompactReductionState,
  ReductionMemoryBudget,
  ReductionReferences,
  compactReductionBytes,
  REDUCTION_REFERENCE_CHUNK,
} from "../src/scan-reduction-storage";
it("accounts fixed typed columns, sources, export scratch and rounded initial incidence before allocation", () => {
  expect(compactReductionBytes(3, 1)).toBe(
    198 * 3 + 126 + REDUCTION_REFERENCE_CHUNK * 4,
  );
  const state = new CompactReductionState(
    new Float64Array(9),
    new Uint32Array([0, 1, 2]),
  );
  expect(state.points.length).toBe(9);
  expect(state.quadrics.length).toBe(30);
  expect(state.triangles.length).toBe(3);
  expect(state.normals.length).toBe(3);
  expect(state.errors.length).toBe(3);
  expect(Array.from(state.order)).toEqual([0]);
  state.dispose();
  expect(state.memory.usedBytes).toBe(0);
});
it("keeps incidence snapshots independent across chunk growth and reset", () => {
  const memory = new ReductionMemoryBudget(1024);
  const references = new ReductionReferences(memory, 2);
  for (const value of [0, 4, 8]) references.push(value);
  const copied = references.snapshot(1, 3);
  references.reset();
  references.push(100);
  expect(Array.from(copied.values)).toEqual([4, 8]);
  expect(references.length).toBe(1);
  expect(references.get(0)).toBe(100);
  copied.release();
  copied.release();
  references.dispose();
  expect(memory.usedBytes).toBe(0);
});
it("fills native incidence slots in arbitrary order while reusing capacity", () => {
  const memory = new ReductionMemoryBudget(32);
  const references = new ReductionReferences(memory, 2);
  references.resize(3);
  references.set(2, 8);
  references.set(0, 0);
  references.set(1, 4);
  const before = memory.usedBytes;
  references.reset();
  references.resize(3);
  expect(memory.usedBytes).toBe(before);
  expect([references.get(0), references.get(1), references.get(2)]).toEqual([
    0, 4, 8,
  ]);
  expect(() => references.set(3, 9)).toThrow();
  expect(() => references.resize(0.5)).toThrow();
  references.dispose();
  expect(memory.usedBytes).toBe(0);
});
it("rejects growth and scratch before allocation without changing stored references", () => {
  const memory = new ReductionMemoryBudget(8);
  const references = new ReductionReferences(memory, 2);
  references.push(1);
  references.push(2);
  expect(() => references.push(3)).toThrow(/working-memory/);
  expect(() => references.snapshot(0, 2)).toThrow(/working-memory/);
  expect(references.length).toBe(2);
  expect(references.get(1)).toBe(2);
  references.dispose();
  expect(memory.usedBytes).toBe(0);
});
it("releases a cancelled incidence snapshot without changing stored references", () => {
  const memory = new ReductionMemoryBudget(32);
  const references = new ReductionReferences(memory, 2);
  references.push(0);
  references.push(4);
  references.push(8);
  const before = memory.usedBytes;
  expect(() =>
    references.snapshot(0, 3, () => {
      throw new DOMException("cancelled", "AbortError");
    }),
  ).toThrow("cancelled");
  expect(memory.usedBytes).toBe(before);
  expect(references.get(2)).toBe(8);
  references.dispose();
  expect(memory.usedBytes).toBe(0);
});
it("checks malformed dimensions, reference encodings and preflight capacity", () => {
  for (const pair of [
    [-1, 0],
    [0, 0.5],
    [Infinity, 0],
    [1, 2 ** 32],
  ])
    expect(() => compactReductionBytes(pair[0], pair[1])).toThrow();
  const references = new ReductionReferences(new ReductionMemoryBudget(32), 2);
  for (const value of [-1, 0.5, 2 ** 32])
    expect(() => references.push(value)).toThrow();
  expect(() => references.get(0)).toThrow();
  expect(() => references.snapshot(0, 1)).toThrow();
  expect(
    () =>
      new CompactReductionState(
        new Float64Array(9),
        new Uint32Array([0, 1, 2]),
        undefined,
        8,
      ),
  ).toThrow(/working-memory/);
  references.dispose();
});

it("unwinds cancelled reference growth before publishing capacity or length", () => {
  const memory = new ReductionMemoryBudget(32);
  const references = new ReductionReferences(memory, 2);
  references.resize(1);
  references.set(0, 42);
  const before = memory.usedBytes;
  expect(() =>
    references.resize(5, () => {
      throw new DOMException("cancelled", "AbortError");
    }),
  ).toThrow("cancelled");
  expect(references.length).toBe(1);
  expect(references.get(0)).toBe(42);
  expect(memory.usedBytes).toBe(before);
  references.dispose();
  expect(memory.usedBytes).toBe(0);
});
