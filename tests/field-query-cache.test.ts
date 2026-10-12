import { describe, expect, it } from "vitest";
import { guideQueryCacheValid } from "../src/field-query-cache";
import { accessGuideQueryContext } from "../src/field-query-context";
import captures from "./fixtures/field-native-query-cache.json";

describe("query cache ready-bit contract", () => {
  it.each(captures.cases)(
    "matches complete original flags $flags",
    ({ flags, valid }) => {
      expect(guideQueryCacheValid(flags)).toBe(valid);
    },
  );
  it.each([0, 2, 4, 128, 254, 256, 0xfffffffe])(
    "rejects clear ready bit in %s",
    (flags) => {
      expect(guideQueryCacheValid(flags)).toBe(false);
    },
  );
  it.each([1, 3, 129, 255, 257, 0xffffffff])(
    "accepts set ready bit in %s",
    (flags) => {
      expect(guideQueryCacheValid(flags)).toBe(true);
    },
  );
  it("uses the ready bit in lazy context access without reinitializing a valid cache", () => {
    const owner = {},
      holder = { context: { owner: null as object | null, flags: 128 } };
    let calls = 0;
    const valid = (context: typeof holder.context) =>
      guideQueryCacheValid(context.flags);
    const initialize = (context: typeof holder.context) => {
      calls++;
      context.flags |= 1;
    };
    expect(
      accessGuideQueryContext(holder, owner, false, valid, initialize),
    ).toBe(holder.context);
    expect(calls).toBe(0);
    accessGuideQueryContext(holder, owner, true, valid, initialize);
    expect(holder.context.owner).toBe(owner);
    expect(holder.context.flags).toBe(129);
    accessGuideQueryContext(holder, {}, true, valid, initialize);
    expect(calls).toBe(1);
    expect(holder.context.owner).toBe(owner);
  });
  it.each([-1, 0.5, NaN, Infinity, 0x100000000])(
    "rejects invalid browser flags %s",
    (flags) => {
      expect(() => guideQueryCacheValid(flags)).toThrow("unsigned 32-bit");
    },
  );
});
