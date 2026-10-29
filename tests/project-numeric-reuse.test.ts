import { expect, it } from "vitest";
import { ProjectNumericReuse } from "../src/project-numeric-reuse";

it("reuses matching live arrays without retaining them strongly", async () => {
  const cache = new ProjectNumericReuse(4);
  const source = [1, -0, 3, 4];
  cache.remember([source]);
  const match = await cache.match(Float64Array.from(source), () => {});
  expect(match).toBe(source);
  expect(Object.is(match![1], -0)).toBe(true);
});

it("rejects stale arrays, signed-zero differences and bounded candidate overflow", async () => {
  const cache = new ProjectNumericReuse(2);
  const stale = [1, 2, 3],
    signed = [1, -0, 3],
    newest = [1, 4, 3];
  cache.remember([stale, signed, newest]);
  expect(await cache.match(Float64Array.of(1, 2, 3), () => {})).toBeUndefined();
  expect(await cache.match(Float64Array.of(1, 0, 3), () => {})).toBeUndefined();
  newest[1] = 9;
  expect(await cache.match(Float64Array.of(1, 4, 3), () => {})).toBeUndefined();
});

it("rechecks values changed while cooperative comparison yields", async () => {
  const cache = new ProjectNumericReuse(2, 2);
  const source = [1, 2, 3, 4];
  cache.remember([source]);
  let yielded = false;
  const match = await cache.match(
    Float64Array.from(source),
    () => {},
    async () => {
      if (!yielded) {
        yielded = true;
        source[0] = 9;
      }
    },
  );
  expect(match).toBeUndefined();
});

it("checks cancellation while matching and never modifies candidate or decoded bytes", async () => {
  const cache = new ProjectNumericReuse(2, 2);
  const source = [1, 2, 3, 4],
    incoming = Float64Array.from(source);
  cache.remember([source]);
  let aborted = false;
  await expect(
    cache.match(
      incoming,
      () => {
        if (aborted) throw Error("cancelled");
      },
      async () => {
        aborted = true;
      },
    ),
  ).rejects.toThrow("cancelled");
  expect(source).toEqual([1, 2, 3, 4]);
  expect([...incoming]).toEqual(source);
});

it("rejects candidates whose length changes while comparison yields", async () => {
  const cache = new ProjectNumericReuse(2, 2);
  const source = [1, 2, 3, 4];
  cache.remember([source]);
  let yielded = false;
  const match = await cache.match(
    Float64Array.from(source),
    () => {},
    async () => {
      if (!yielded) {
        yielded = true;
        source.push(5);
      }
    },
  );
  expect(match).toBeUndefined();
});

it("falls back when weak references are unavailable and rejects nonfinite candidates", async () => {
  const cache = new ProjectNumericReuse(2);
  const source = [1, Infinity, 3];
  cache.remember([source]);
  expect(
    await cache.match(Float64Array.from(source), () => {}),
  ).toBeUndefined();
  cache.clear();
  const original = globalThis.WeakRef;
  try {
    Object.defineProperty(globalThis, "WeakRef", {
      value: undefined,
      configurable: true,
    });
    cache.remember([[1, 2, 3]]);
  } finally {
    Object.defineProperty(globalThis, "WeakRef", {
      value: original,
      configurable: true,
    });
  }
  expect(await cache.match(Float64Array.of(1, 2, 3), () => {})).toBeUndefined();
});
