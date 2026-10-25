import { readFileSync, openSync, closeSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readAscPointCloud } from "../src/asc-import";

const folder = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
it.skipIf(!folder).each([
  [1, 140113],
  [2, 1375494],
  [3, 1865848],
])(
  "imports every owner ASC point and normal from scan %i",
  async (scan, count) => {
    const path = join(folder!, `asc-${scan}.asc`),
      fd = openSync(path, "r");
    try {
      const cloud = await readAscPointCloud(
        {
          size: statSync(path).size,
          arrayBuffer: async () => {
            throw new Error(
              "Full-file reads are forbidden in this streaming regression.",
            );
          },
          slice: (start = 0, end = statSync(path).size) => ({
            arrayBuffer: async () => {
              const raw = Buffer.alloc(end - start);
              expect(readSync(fd, raw, 0, raw.length, start)).toBe(raw.length);
              return raw.buffer.slice(
                raw.byteOffset,
                raw.byteOffset + raw.length,
              ) as ArrayBuffer;
            },
          }),
        },
        { attributes: "xyz-normal" },
      );
      expect(cloud.positions.length).toBe(count * 3);
      expect(cloud.normals?.length).toBe(count * 3);
      const ply = readFileSync(join(folder!, `ply-${scan}.ply`));
      const offset = ply.indexOf("\n", ply.indexOf("end_header")) + 1;
      let maximumCoordinateDifference = 0,
        maximumNormalDifference = 0;
      for (let point = 0; point < count; point++)
        for (let axis = 0; axis < 3; axis++) {
          maximumCoordinateDifference = Math.max(
            maximumCoordinateDifference,
            Math.abs(
              cloud.positions[point * 3 + axis] -
                ply.readFloatLE(offset + point * 24 + axis * 4),
            ),
          );
          maximumNormalDifference = Math.max(
            maximumNormalDifference,
            Math.abs(
              cloud.normals![point * 3 + axis] -
                ply.readFloatLE(offset + point * 24 + 12 + axis * 4),
            ),
          );
        }
      // ASC text is rounded to 0.001 mm and six-decimal normals in these owner files.
      expect(maximumCoordinateDifference).toBeLessThanOrEqual(0.0006);
      expect(maximumNormalDifference).toBeLessThanOrEqual(0.0000006);
    } finally {
      closeSync(fd);
    }
  },
  120000,
);
