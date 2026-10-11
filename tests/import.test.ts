import { describe, expect, it } from "vitest";
import { readScan, type ScanFile } from "../src/import-parser";

function generatedBinaryStl(triangles: number) {
  const header = new ArrayBuffer(84);
  new DataView(header).setUint32(80, triangles, true);
  const size = 84 + triangles * 50;
  const reads: number[] = [];
  const file: ScanFile = {
    size,
    async arrayBuffer() {
      throw new Error("Whole-file buffering is forbidden in this fixture.");
    },
    slice(start = 0, end = size) {
      return {
        async arrayBuffer() {
          reads.push(end - start);
          if (start === 0) return header.slice(0, end);
          const chunk = new ArrayBuffer(end - start);
          const view = new DataView(chunk);
          for (let i = 0; i < chunk.byteLength / 50; i++) {
            view.setFloat32(i * 50 + 24, 10, true);
            view.setFloat32(i * 50 + 40, 5, true);
          }
          return chunk;
        },
      };
    },
  };
  return { file, reads };
}

describe("chunked scan imports", () => {
  it("validates an over-1GB binary source using bounded sampled geometry", async () => {
    const { file, reads } = generatedBinaryStl(22_000_000);
    let source: unknown;
    const positions = await readScan(file, "stl", {
      previewTriangles: 250_000,
      onSource: (value) => {
        source = value;
      },
    });
    expect(file.size).toBeGreaterThan(1024 ** 3);
    expect(positions.byteLength).toBe(9_000_000);
    expect(source).toEqual({
      bytes: 1_100_000_084,
      triangles: 22_000_000,
      displayedTriangles: 250_000,
    });
    expect(Math.max(...reads)).toBeLessThan(1024 * 1024);
    expect(reads.reduce((a, b) => a + b, 0)).toBe(file.size);
  }, 30_000);
  it("rejects invalid coordinates in triangles omitted from the preview", async () => {
    const { file } = generatedBinaryStl(10);
    const invalid: ScanFile = {
      ...file,
      slice(start, end) {
        const part = file.slice(start, end);
        return {
          async arrayBuffer() {
            const chunk = await part.arrayBuffer();
            if (start !== 0)
              new DataView(chunk).setFloat32(50 + 12, Infinity, true);
            return chunk;
          },
        };
      },
    };
    await expect(
      readScan(invalid, "stl", { previewTriangles: 1 }),
    ).rejects.toThrow("finite");
    await expect(
      readScan(file, "stl", { previewTriangles: 0 }),
    ).rejects.toThrow("positive integer");
  });
  it("imports a 200 MB STL above former byte and triangle limits without whole-file buffering", async () => {
    const { file, reads } = generatedBinaryStl(4_000_000);
    const progress: number[] = [];
    const positions = await readScan(file, "stl", {
      onProgress: (value) => progress.push(value),
    });
    expect(file.size).toBeGreaterThan(200_000_000);
    expect(positions).toBeInstanceOf(Float32Array);
    expect(positions.length).toBe(36_000_000);
    expect(Array.from(positions.subarray(0, 9))).toEqual([
      0, 0, 0, 10, 0, 0, 0, 5, 0,
    ]);
    expect(positions[positions.length - 2]).toBe(5);
    expect(Math.max(...reads)).toBeLessThan(1024 * 1024);
    expect(progress.at(-1)).toBe(1);
  }, 20_000);

  it("rejects inconsistent binary counts before allocating geometry", async () => {
    const { file } = generatedBinaryStl(1);
    await expect(
      readScan({ ...file, size: file.size - 1 }, "stl"),
    ).rejects.toThrow("length");
  });

  it("rejects non-finite coordinates and truncated chunks", async () => {
    const { file } = generatedBinaryStl(1);
    const invalid: ScanFile = {
      ...file,
      slice(start, end) {
        const part = file.slice(start, end);
        return {
          async arrayBuffer() {
            const chunk = await part.arrayBuffer();
            if (start !== 0) new DataView(chunk).setFloat32(12, NaN, true);
            return chunk;
          },
        };
      },
    };
    await expect(readScan(invalid, "stl")).rejects.toThrow("finite");
    const truncated: ScanFile = {
      ...file,
      slice(start, end) {
        return start === 0
          ? file.slice(start, end)
          : {
              async arrayBuffer() {
                return new ArrayBuffer(0);
              },
            };
      },
    };
    await expect(readScan(truncated, "stl")).rejects.toThrow("Truncated");
  });

  it("cancels after a chunk and stops subsequent reads", async () => {
    const { file, reads } = generatedBinaryStl(32_768);
    const controller = new AbortController();
    await expect(
      readScan(file, "stl", {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(reads).toHaveLength(2);
  });
});
