import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import * as THREE from "three";
import { readAscPointCloud } from "../src/asc-import";
import { PointScreenSelectionIndex } from "../src/point-screen-selection";

const folder = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
it.skipIf(!folder).each([1, 2, 3])(
  "selects actual owner ASC scan %i without triangle conversion",
  async (scan) => {
    const path = join(folder!, `asc-${scan}.asc`),
      fd = openSync(path, "r"),
      size = statSync(path).size;
    try {
      const cloud = await readAscPointCloud({
        size,
        arrayBuffer: async () => {
          throw new Error("Streaming only");
        },
        slice: (start = 0, end = size) => ({
          arrayBuffer: async () => {
            const buffer = Buffer.alloc(end - start);
            readSync(fd, buffer, 0, buffer.length, start);
            return buffer.buffer.slice(
              buffer.byteOffset,
              buffer.byteOffset + buffer.length,
            ) as ArrayBuffer;
          },
        }),
      });
      const bounds = new THREE.Box3().setFromBufferAttribute(
        new THREE.BufferAttribute(cloud.positions, 3),
      );
      const center = bounds.getCenter(new THREE.Vector3()),
        span = Math.max(...bounds.getSize(new THREE.Vector3()).toArray()) * 1.2;
      const camera = new THREE.OrthographicCamera(
        -span / 2,
        span / 2,
        span / 2,
        -span / 2,
        0.01,
        span * 4,
      );
      camera.position.copy(center).add(new THREE.Vector3(0, 0, span));
      camera.lookAt(center);
      camera.updateMatrixWorld();
      const index = new PointScreenSelectionIndex(cloud.positions);
      const region = {
        kind: "rectangle" as const,
        start: [0, 0] as [number, number],
        end: [1200, 800] as [number, number],
      };
      const start = performance.now();
      const all = index.select(camera, region, {
        width: 1200,
        height: 800,
        through: true,
      });
      const throughMs = performance.now() - start;
      expect(all.length).toBe(cloud.positions.length / 3);
      expect(all.every(Boolean)).toBe(true);
      const frontStart = performance.now();
      const visible = index.select(camera, region, {
        width: 1200,
        height: 800,
        through: false,
      });
      expect(visible.length).toBe(all.length);
      expect(visible.some(Boolean)).toBe(true);
      console.log(
        JSON.stringify({
          scan,
          points: all.length,
          throughMs,
          visibleMs: performance.now() - frontStart,
        }),
      );
    } finally {
      closeSync(fd);
    }
  },
  120000,
);
