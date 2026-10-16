import { expect, it } from "vitest";
import { createNativeAlignmentEdgeRecords } from "../src/scan-native-edge-records";

it("preserves first records, zero slots and consumed markers through collisions and growth", () => {
  const directory = createNativeAlignmentEdgeRecords(100003, 50000);
  const reference = new Map<string, number>();
  const before = directory.byteLength!;
  for (let i = 0; i < 50000; i++) {
    const from = i,
      to = Math.imul(i, 7919) % 100003,
      key = `${from}:${to}`;
    directory.remember(from, to, i);
    if (!reference.has(key)) reference.set(key, i);
    if (i % 3 === 0) {
      directory.set(from, to, -i - 1);
      reference.set(key, -i - 1);
    }
    directory.remember(from, to, (i + 7) % 50000);
  }
  expect(directory.kind).toBe("compact");
  expect(directory.size).toBe(reference.size);
  expect(directory.byteLength!).toBeGreaterThan(before);
  for (const [key, value] of reference) {
    const [from, to] = key.split(":").map(Number);
    expect(directory.get(from, to)).toBe(value);
  }
  expect(directory.get(100002, 100002)).toBeUndefined();
});

it("distinguishes both directions and the full unsigned vertex range", () => {
  const directory = createNativeAlignmentEdgeRecords(0x100000000, 8);
  directory.remember(0xffffffff, 0, 0);
  directory.remember(0, 0xffffffff, 1);
  directory.remember(0xffffffff, 0xffffffff, 2);
  expect(directory.get(0xffffffff, 0)).toBe(0);
  expect(directory.get(0, 0xffffffff)).toBe(1);
  expect(directory.get(0xffffffff, 0xffffffff)).toBe(2);
  directory.set(0xffffffff, 0, -1);
  directory.remember(0xffffffff, 0, 4);
  expect(directory.get(0xffffffff, 0)).toBe(-1);
});

it("retains wider records in the Map fallback without truncation", () => {
  const directory = createNativeAlignmentEdgeRecords(0x100000010, 0x80000010);
  expect(directory.kind).toBe("map");
  directory.remember(0x100000001, 1, 0x80000001);
  directory.set(0x100000001, 1, -0x80000002);
  directory.remember(0x100000001, 1, 0);
  expect(directory.get(0x100000001, 1)).toBe(-0x80000002);
  expect(directory.get(1, 1)).toBeUndefined();
});

it("does not publish a partially rehashed table when cancelled", () => {
  let checks = 0,
    abortAt = Infinity;
  const signal = {
    get aborted() {
      return ++checks >= abortAt;
    },
  } as AbortSignal;
  const directory = createNativeAlignmentEdgeRecords(1024, 512, { signal });
  let failed = false,
    before = 0;
  for (let i = 0; i < 512; i++) {
    before = directory.size;
    abortAt = checks + 2;
    try {
      directory.remember(i, 0, i);
    } catch (error) {
      expect((error as Error).name).toBe("AbortError");
      failed = true;
      break;
    }
  }
  expect(failed).toBe(true);
  expect(directory.size).toBe(before);
  for (let i = 0; i < before; i++) expect(directory.get(i, 0)).toBe(i);
});

it("rejects invalid dimensions and writes without modifying previous records", () => {
  expect(() => createNativeAlignmentEdgeRecords(-1, 4)).toThrow();
  expect(() => createNativeAlignmentEdgeRecords(4, NaN)).toThrow();
  const directory = createNativeAlignmentEdgeRecords(4, 8);
  directory.remember(0, 1, 0);
  for (const args of [
    [4, 1, 0],
    [0, -1, 0],
    [0, 1, 8],
    [0, 1, -9],
    [0, 1, 0.5],
  ])
    expect(() =>
      directory.set(...(args as [number, number, number])),
    ).toThrow();
  expect(directory.size).toBe(1);
  expect(directory.get(0, 1)).toBe(0);
});

it("reserves from observed topology without treating unused vertices as edges", () => {
  const directory = createNativeAlignmentEdgeRecords(1000000, 3000000, {
    expectedEntries: 9,
  });
  directory.remember(0, 1, 0);
  directory.remember(1, 2, 1);
  directory.remember(2, 0, 2);
  expect(directory.size).toBe(3);
  expect(directory.byteLength).toBe(16 * 12);
  expect(() =>
    createNativeAlignmentEdgeRecords(3, 3, { expectedEntries: 4 }),
  ).toThrow();
  expect(() =>
    createNativeAlignmentEdgeRecords(3, 3, { expectedEntries: NaN }),
  ).toThrow();
  expect(() =>
    createNativeAlignmentEdgeRecords(0x100000000, 0x7fffffff, {
      expectedEntries: 0x7fffffff,
    }),
  ).toThrow("capacity exceeded");
});
