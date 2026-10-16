import { expect, it } from "vitest";
import {
  createNativeTargetStorageBudget,
  withNativeTargetStorageBudget,
  nativeTargetStorage,
  nativeScratchStorage,
  releaseNativeScratch,
} from "../src/scan-native-target-storage";

it("checks the complete live baseline before allocating and retires only owned scratch", () => {
  const budget = createNativeTargetStorageBudget(1024, 128);
  const authored = Float32Array.of(1, 2, 3);
  withNativeTargetStorageBudget(budget, () => {
    const output = nativeTargetStorage(authored, 64);
    const scratch = nativeScratchStorage(256);
    expect(budget.snapshot()).toEqual({
      limit: 1024,
      reserved: 128,
      live: 448,
      peak: 448,
    });
    expect(() => nativeScratchStorage(577)).toThrow(/whole-scene/);
    expect(budget.snapshot().live).toBe(448);
    expect(releaseNativeScratch(authored.buffer)).toBe(false);
    expect(releaseNativeScratch(output)).toBe(false);
    expect(releaseNativeScratch(scratch)).toBe(true);
    expect(releaseNativeScratch(scratch)).toBe(false);
    expect(budget.snapshot()).toEqual({
      limit: 1024,
      reserved: 128,
      live: 192,
      peak: 448,
    });
  });
  expect(authored).toEqual(Float32Array.of(1, 2, 3));
});

it("restores the allocation scope on failure and rejects overlapping scopes", () => {
  const budget = createNativeTargetStorageBudget(32, 0);
  expect(() =>
    withNativeTargetStorageBudget(budget, () => {
      expect(() => withNativeTargetStorageBudget(budget, () => 1)).toThrow(
        /overlap/,
      );
      nativeScratchStorage(33);
    }),
  ).toThrow(/whole-scene/);
  expect(nativeScratchStorage(64).byteLength).toBe(64);
  expect(
    withNativeTargetStorageBudget(
      budget,
      () => nativeTargetStorage([], 16).byteLength,
    ),
  ).toBe(16);
});

it("charges shared outputs once and keeps scratch charged without transfer support", () => {
  const budget = createNativeTargetStorageBudget(1024, 128);
  const source = new Float32Array(new SharedArrayBuffer(12));
  const descriptor = Object.getOwnPropertyDescriptor(
    ArrayBuffer.prototype,
    "transfer",
  )!;
  Object.defineProperty(ArrayBuffer.prototype, "transfer", {
    ...descriptor,
    value: undefined,
  });
  try {
    withNativeTargetStorageBudget(budget, () => {
      const output = nativeTargetStorage(source, 64),
        scratch = nativeScratchStorage(128);
      expect(output).toBeInstanceOf(SharedArrayBuffer);
      expect(releaseNativeScratch(scratch)).toBe(false);
      expect(budget.snapshot().live).toBe(320);
    });
  } finally {
    Object.defineProperty(ArrayBuffer.prototype, "transfer", descriptor);
  }
});
it("does not let a failed transfer mask operation errors or uncharge live storage", () => {
  const budget = createNativeTargetStorageBudget(1024, 128);
  const descriptor = Object.getOwnPropertyDescriptor(
    ArrayBuffer.prototype,
    "transfer",
  )!;
  Object.defineProperty(ArrayBuffer.prototype, "transfer", {
    ...descriptor,
    value() {
      throw Error("unsupported");
    },
  });
  try {
    withNativeTargetStorageBudget(budget, () => {
      const scratch = nativeScratchStorage(128);
      expect(() => releaseNativeScratch(scratch)).not.toThrow();
      expect(releaseNativeScratch(scratch)).toBe(false);
      expect(scratch.byteLength).toBe(128);
      expect(budget.snapshot().live).toBe(256);
    });
  } finally {
    Object.defineProperty(ArrayBuffer.prototype, "transfer", descriptor);
  }
});

it.each([
  [0, 0],
  [513 * 1048576, 0],
  [1024, 1025],
  [1024, -1],
  [Infinity, 0],
  [1024, NaN],
])("rejects invalid admission %s / %s", (limit, reserved) => {
  expect(() => createNativeTargetStorageBudget(limit, reserved)).toThrow(
    /admission/,
  );
});
