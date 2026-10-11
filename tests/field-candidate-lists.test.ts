import { describe, expect, it } from "vitest";
import {
  createFieldCandidateList,
  fieldCandidateIds,
  prepareFieldCandidateLists,
  removeFieldCandidates,
} from "../src/field-candidate-lists";
import { selectFieldResidualCandidates } from "../src/field-residual-selection";

describe("recovered candidate-list lifecycle", () => {
  it("creates ascending links with a head sentinel and an empty terminator", () => {
    const list = createFieldCandidateList(3);
    expect([...list.next]).toEqual([1, 2, -1, 0]);
    expect([...list.previous]).toEqual([3, 0, 1]);
    expect([...fieldCandidateIds(list)]).toEqual([0, 1, 2]);
    const empty = createFieldCandidateList(0);
    expect([...empty.next]).toEqual([-1]);
    expect(fieldCandidateIds(empty).length).toBe(0);
  });

  it("uses strict float strength cutoff and honors both bitsets including declared lengths", () => {
    const strengths = new Float32Array(11).fill(1);
    strengths[0] = 0;
    strengths[1] = Math.fround(0.000002);
    strengths[2] = Math.fround(0.000002) * 2;
    const pools = prepareFieldCandidateLists(
      3,
      strengths,
      { bits: new Uint8Array([8, 255]), bitCount: 9 },
      { bits: new Uint8Array([32]), bitCount: 8 },
    );
    expect([...fieldCandidateIds(pools.connections)]).toEqual([0, 1, 2]);
    expect([...fieldCandidateIds(pools.nodes)]).toEqual([2, 4, 6, 7, 9, 10]);
    expect(pools.nodes.remaining).toBe(6);
    expect(pools.nodes.next[11]).toBe(2);
    expect(pools.nodes.previous[2]).toBe(11);
  });

  it("unlinks the head, middle and tail while preserving source ownership", () => {
    const list = createFieldCandidateList(5);
    const before = structuredClone(list);
    const output = removeFieldCandidates(list, new Uint32Array([0, 2, 4]));
    expect([...fieldCandidateIds(output)]).toEqual([1, 3]);
    expect(output.next[5]).toBe(1);
    expect(output.previous[1]).toBe(5);
    expect(output.previous[3]).toBe(1);
    expect(output.next[3]).toBe(-1);
    for (const id of [0, 2, 4]) {
      expect(output.next[id]).toBe(-2);
      expect(output.previous[id]).toBe(-2);
    }
    expect(list).toEqual(before);
    expect(output.next.buffer).not.toBe(list.next.buffer);
    expect(output.previous.buffer).not.toBe(list.previous.buffer);
    const drained = removeFieldCandidates(output, new Uint32Array([3, 1]));
    expect(drained.remaining).toBe(0);
    expect(drained.next[5]).toBe(-1);
    expect(fieldCandidateIds(drained).length).toBe(0);
  });

  it("selects only remaining candidates across repeated residual passes", () => {
    let list = createFieldCandidateList(3);
    const residuals = [0.1, 0.2, 0.3];
    const selected: number[] = [];
    for (let step = 0; step < 3; step++) {
      const candidates = Array.from(fieldCandidateIds(list), (id) => ({
        id,
        residual: residuals[id],
      }));
      const result = selectFieldResidualCandidates(candidates, [], 1, 0);
      selected.push(...result.connections);
      list = removeFieldCandidates(list, result.connections);
      expect(list.remaining).toBe(2 - step);
    }
    expect(selected).toEqual([0, 1, 2]);
    expect(fieldCandidateIds(list).length).toBe(0);
  });

  it("rejects repeated/inactive removals and malformed lists without modifying inputs", () => {
    const list = createFieldCandidateList(3);
    const before = structuredClone(list);
    expect(() =>
      removeFieldCandidates(list, new Uint32Array([1, 1])),
    ).toThrow();
    expect(() => removeFieldCandidates(list, new Uint32Array([3]))).toThrow();
    const removed = removeFieldCandidates(list, new Uint32Array([1]));
    expect(() =>
      removeFieldCandidates(removed, new Uint32Array([1])),
    ).toThrow();
    expect(list).toEqual(before);
    const cycle = structuredClone(list);
    cycle.next[2] = 0;
    expect(() => fieldCandidateIds(cycle)).toThrow();
    expect(() => fieldCandidateIds({ ...list, remaining: 1 })).toThrow();
    expect(() =>
      fieldCandidateIds({ ...list, previous: new Int32Array([3, 0, 0]) }),
    ).toThrow();
  });

  it("handles excluded pools and rejects invalid dimensions, flags, strengths and bit storage", () => {
    const pools = prepareFieldCandidateLists(0, new Float32Array([0, -1]));
    expect(pools.nodes.remaining + pools.connections.remaining).toBe(0);
    expect(() => createFieldCandidateList(-1)).toThrow();
    expect(() => createFieldCandidateList(2, new Uint8Array([1]))).toThrow();
    expect(() => createFieldCandidateList(1, new Uint8Array([2]))).toThrow();
    expect(() =>
      prepareFieldCandidateLists(0, new Float32Array([NaN])),
    ).toThrow();
    expect(() =>
      prepareFieldCandidateLists(0, new Float32Array([1]), {
        bits: new Uint8Array([1]),
        bitCount: 9,
      }),
    ).toThrow();
  });
});
