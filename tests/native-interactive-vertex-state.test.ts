import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import manifest from "./fixtures/interactive-vertex-state-native.manifest.json";
import { refreshNativeVertexState } from "../src/interactive-mesh-source";
const compressed = readFileSync(
  new URL(
    "./fixtures/interactive-vertex-state-native.json.gz",
    import.meta.url,
  ),
);
const raw = gunzipSync(compressed);
const native = JSON.parse(raw.toString()) as {
  seeds: number[][];
  triangles: number[][];
  cases: {
    seed: number;
    faceFlags: number[];
    ready: number;
    flags: number[];
    selected: number;
    hidden: number;
    visibleFaces: number;
  }[];
};
it("binds the complete original refresh/cache-guard executions to their fixture", () => {
  expect(createHash("sha256").update(raw).digest("hex")).toBe(
    manifest.rawSha256,
  );
  expect(createHash("sha256").update(compressed).digest("hex")).toBe(
    manifest.compressedSha256,
  );
  expect(native.cases).toHaveLength(4100);
});
it.each(native.cases.map((c, index) => ({ ...c, index })))(
  "matches original vertex visibility, selection and cache state $index",
  (c) => {
    const flags = Uint32Array.from(native.seeds[c.seed]);
    const state = {
      flags,
      ready: !!c.ready,
      selected: 77,
      hidden: 99,
      visibleFaces: 123,
    };
    expect(
      refreshNativeVertexState(
        state,
        Uint32Array.from(native.triangles.flat()),
        Uint8Array.from(c.faceFlags),
      ),
    ).toBe(state);
    expect(Array.from(flags)).toEqual(c.flags);
    expect([
      state.ready,
      state.selected,
      state.hidden,
      state.visibleFaces,
    ]).toEqual([true, c.selected, c.hidden, c.visibleFaces]);
  },
);
it("does not revisit triangles when the native cache is current", () => {
  const state = {
    flags: new Uint32Array([0]),
    ready: true,
    selected: 0,
    hidden: 0,
    visibleFaces: 0,
  };
  const triangles = new Proxy([], {
    get() {
      throw Error("cached topology was revisited");
    },
  }) as unknown as Uint32Array;
  expect(refreshNativeVertexState(state, triangles, new Uint8Array())).toBe(
    state,
  );
});
it("rejects unsafe fresh topology before changing any vertex flags", () => {
  const state = {
    flags: new Uint32Array([2, 3, 4]),
    ready: false,
    selected: 1,
    hidden: 0,
    visibleFaces: 1,
  };
  expect(() =>
    refreshNativeVertexState(
      state,
      new Uint32Array([0, 1, 3]),
      new Uint8Array([1]),
    ),
  ).toThrow();
  expect(Array.from(state.flags)).toEqual([2, 3, 4]);
  expect(state.ready).toBe(false);
});
