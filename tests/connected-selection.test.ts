import { describe, expect, it } from "vitest";
import { growConnectedSelection } from "../src/connected-selection";

const flat = [0, 0, 0, 10, 0, 0, 0, 10, 0];
const neighbor = [10, 0, 0, 10, 10, 0, 0, 10, 0];
const options = { tolerance: 0.001, angleDegrees: 30 };
describe("connected triangle selection", () => {
  it("selects an entire bent component while retaining separate islands and the angle setting", () => {
    const bent = [10, 0, 0, 0, 0, 0, 0, 0, 10];
    const island = [50, 0, 0, 60, 0, 0, 50, 10, 0];
    const seeds = new Uint8Array([1, 0, 0]);
    const settings = { ...options, angleDegrees: 1.84, allConnected: true };
    expect(
      Array.from(
        growConnectedSelection([...flat, ...bent, ...island], seeds, settings),
      ),
    ).toEqual([1, 1, 0]);
    expect(Array.from(seeds)).toEqual([1, 0, 0]);
    expect(settings.angleDegrees).toBe(1.84);
    expect(
      Array.from(
        growConnectedSelection([...flat, ...bent, ...island], seeds, {
          ...settings,
          allConnected: false,
        }),
      ),
    ).toEqual([1, 0, 0]);
  });
  it("grows coplanar welded neighbors without changing seeds or coordinates", () => {
    const positions = new Float32Array([
      ...flat,
      ...neighbor,
      50,
      0,
      0,
      60,
      0,
      0,
      50,
      10,
      0,
    ]);
    const seeds = new Uint8Array([1, 0, 0]);
    expect(
      Array.from(growConnectedSelection(positions, seeds, options)),
    ).toEqual([1, 1, 0]);
    expect(Array.from(seeds)).toEqual([1, 0, 0]);
    expect(positions[0]).toBe(0);
  });
  it("ignores winding but stops at creases, vertex contacts and nonmanifold edges", () => {
    const reversed = [0, 10, 0, 10, 10, 0, 10, 0, 0];
    expect(
      Array.from(
        growConnectedSelection(
          [...flat, ...reversed],
          new Uint8Array([1, 0]),
          options,
        ),
      ),
    ).toEqual([1, 1]);
    const bent = [10, 0, 0, 0, 0, 0, 0, 0, 10];
    expect(
      Array.from(
        growConnectedSelection(
          [...flat, ...bent],
          new Uint8Array([1, 0]),
          options,
        ),
      ),
    ).toEqual([1, 0]);
    expect(
      Array.from(
        growConnectedSelection([...flat, ...bent], new Uint8Array([1, 0]), {
          ...options,
          angleDegrees: 90,
        }),
      ),
    ).toEqual([1, 1]);
    const vertexOnly = [0, 0, 0, -10, 0, 0, 0, -10, 0];
    expect(
      Array.from(
        growConnectedSelection(
          [...flat, ...vertexOnly],
          new Uint8Array([1, 0]),
          options,
        ),
      ),
    ).toEqual([1, 0]);
    const junction = [10, 0, 0, 0, 0, 0, 5, 0, -10];
    expect(
      Array.from(
        growConnectedSelection(
          [...flat, ...bent, ...junction],
          new Uint8Array([1, 0, 0]),
          { ...options, angleDegrees: 90 },
        ),
      ),
    ).toEqual([1, 0, 0]);
  });
  it("validates masks, tolerances, angles and cancellation", () => {
    expect(() =>
      growConnectedSelection(flat, new Uint8Array(2), options),
    ).toThrow(/mask/);
    expect(() =>
      growConnectedSelection(flat, new Uint8Array([2]), options),
    ).toThrow(/zero or one/);
    expect(() =>
      growConnectedSelection(flat, new Uint8Array([1]), {
        ...options,
        angleDegrees: 100,
      }),
    ).toThrow(/angle/);
    expect(() =>
      growConnectedSelection(flat, new Uint8Array([1]), {
        ...options,
        tolerance: 0,
      }),
    ).toThrow(/tolerance/);
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      growConnectedSelection(flat, new Uint8Array([1]), {
        ...options,
        signal: controller.signal,
      }),
    ).toThrow(/cancelled/);
    expect(
      Array.from(growConnectedSelection(flat, new Uint8Array([0]), options)),
    ).toEqual([0]);
  });
});
