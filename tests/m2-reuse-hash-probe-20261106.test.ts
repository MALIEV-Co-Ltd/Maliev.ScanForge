import { expect, it } from "vitest";
import {
  packProjectTransport,
  unpackProjectTransport,
} from "../src/project-transport-hash-probe";
it("rejects a changed previously matched candidate before publishing the graph", async () => {
  const first = Array.from({ length: 65536 }, (_, i) => (i === 0 ? -0 : i)),
    second = Array.from({ length: 65536 }, (_, i) => i + 1);
  const { packet } = await packProjectTransport({
    first,
    alias: first,
    second,
  });
  let count = 0;
  await expect(
    unpackProjectTransport(packet, {
      releaseOwnedNumericBuffers: true,
      reuseNumericArray: async () => {
        if (count++ === 0) return first;
        first[1] = 999;
        return second;
      },
    }),
  ).rejects.toThrow("Numeric reuse candidate changed during restore.");
});
it("retains valid source aliases and signed zero", async () => {
  const first = Array.from({ length: 65536 }, (_, i) => (i === 0 ? -0 : i));
  const { packet } = await packProjectTransport({ first, alias: first });
  const out = await unpackProjectTransport<{
    first: number[];
    alias: number[];
  }>(packet, {
    releaseOwnedNumericBuffers: true,
    reuseNumericArray: async () => first,
  });
  expect(out.first).toBe(first);
  expect(out.alias).toBe(first);
  expect(Object.is(out.first[0], -0)).toBe(true);
});
