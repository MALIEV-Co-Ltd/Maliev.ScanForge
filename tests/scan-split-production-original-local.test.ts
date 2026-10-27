/// <reference types="node" />
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parsePlyTopology } from "../src/ply-topology";
import { splitGeneralCutter } from "../src/scan-edit-general-split";

it.skipIf(!process.env.SCANFORGE_M2_ORIGINAL_PLY)(
  "checks original scan area and finite cutter seam in shared Split",
  () => {
    const bytes = readFileSync(process.env.SCANFORGE_M2_ORIGINAL_PLY!);
    const mesh = parsePlyTopology(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const positions = new Float32Array(mesh.triangles.length * 3);
    const bounds = [
      Infinity,
      Infinity,
      Infinity,
      -Infinity,
      -Infinity,
      -Infinity,
    ];
    for (let i = 0; i < mesh.triangles.length; i++) {
      const k = mesh.triangles[i] * 3;
      for (let axis = 0; axis < 3; axis++) {
        const value = mesh.vertices[k + axis];
        positions[i * 3 + axis] = value;
        bounds[axis] = Math.min(bounds[axis], value);
        bounds[axis + 3] = Math.max(bounds[axis + 3], value);
      }
    }
    const x = (bounds[0] + bounds[3]) / 2,
      margin = Math.max(bounds[4] - bounds[1], bounds[5] - bounds[2], 1);
    const cutter = new Float32Array([
      x,
      bounds[1] - margin,
      bounds[2] - margin,
      x,
      bounds[1] - margin,
      bounds[5] + 3 * margin,
      x,
      bounds[4] + 3 * margin,
      bounds[2] - margin,
    ]);
    const digest = (arr: Float32Array) =>
      createHash("sha256")
        .update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength))
        .digest("hex");
    const sourceBefore = digest(positions),
      cutterBefore = digest(cutter);
    const result = splitGeneralCutter(
      { kind: "scanEdit", action: "split", positions, target: cutter },
      {},
    );
    expect(digest(positions)).toBe(sourceBefore);
    expect(digest(cutter)).toBe(cutterBefore);
    expect(result.segments!.filter((part) => part.length)).toHaveLength(2);
    const area = (arr: Float32Array) => {
      let sum = 0;
      for (let i = 0; i < arr.length; i += 9) {
        const ax = arr[i + 3] - arr[i],
          ay = arr[i + 4] - arr[i + 1],
          az = arr[i + 5] - arr[i + 2];
        const bx = arr[i + 6] - arr[i],
          by = arr[i + 7] - arr[i + 1],
          bz = arr[i + 8] - arr[i + 2];
        sum +=
          Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) /
          2;
      }
      return sum;
    };
    const edges = (arr: Float32Array) => {
      const found = new Map<string, number>();
      for (let i = 0; i < arr.length; i += 9)
        for (let j = 0; j < 3; j++) {
          const a = i + 3 * j,
            b = i + 3 * ((j + 1) % 3);
          if (arr[a] !== cutter[0] || arr[b] !== cutter[0]) continue;
          const first = `${arr[a + 1]},${arr[a + 2]}`,
            second = `${arr[b + 1]},${arr[b + 2]}`;
          const key =
            first < second ? `${first}|${second}` : `${second}|${first}`;
          found.set(key, (found.get(key) ?? 0) + 1);
        }
      return found;
    };
    const sourceArea = area(positions),
      partsArea = result.segments!.map(area);
    const first = edges(result.segments![0]),
      second = edges(result.segments![1]);
    expect(first.size).toBeGreaterThan(0);
    expect([...first.keys()].filter((key) => !second.has(key))).toEqual([]);
    expect([...second.keys()].filter((key) => !first.has(key))).toEqual([]);
    expect(
      Math.abs(partsArea[0] + partsArea[1] - sourceArea) / sourceArea,
    ).toBeLessThan(1e-5);
    console.log(
      JSON.stringify({
        faces: positions.length / 9,
        sourceArea,
        partsArea,
        seamEdges: first.size,
        sourceBefore,
        cutterBefore,
      }),
    );
  },
  120_000,
);
