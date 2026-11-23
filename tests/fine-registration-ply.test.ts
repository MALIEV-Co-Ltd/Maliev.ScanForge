import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parsePackedBinaryPly } from "../src/ply-binary-topology";
import { registerFineAlignment } from "../src/fine-registration";

const folder = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
it.skipIf(!folder)(
  "preserves the genuine partial overlap on the owner's PLY thin-wall scans",
  () => {
    const read = (name: string) => {
      const file = readFileSync(join(folder!, name));
      const mesh = parsePackedBinaryPly(
        file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
      );
      if (!mesh) throw new Error(`Expected binary PLY topology: ${name}`);
      return mesh;
    };
    const source = read("ply-2.ply"),
      target = read("ply-1.ply");
    const digest = () =>
      [source, target]
        .flatMap((mesh) => [mesh.vertices, mesh.normals!, mesh.triangles])
        .map((buffer) =>
          createHash("sha256")
            .update(
              new Uint8Array(
                buffer.buffer,
                buffer.byteOffset,
                buffer.byteLength,
              ),
            )
            .digest("hex"),
        );
    const original = digest();
    const options = {
      targetSurface: target,
      sourceNormals: source.normals,
      targetRms: 0.5,
      maxDistance: 10,
      sampleSize: 20000,
      maxIterations: 3,
    };
    const refused = registerFineAlignment(source.vertices, target.vertices, {
      ...options,
      overlapPercent: 85,
    });
    expect(refused).toMatchObject({
      applied: false,
      iterations: 0,
      targetReached: false,
      terminationReason: "insufficientOverlap",
    });
    expect(refused.transform.translation).toEqual([0, 0, 0]);
    expect(refused.overlapFraction).toBeGreaterThan(0.3);
    expect(refused.overlapFraction).toBeLessThan(0.35);
    const fitted = registerFineAlignment(source.vertices, target.vertices, {
      ...options,
      overlapPercent: 15,
    });
    expect(fitted).toMatchObject({
      applied: true,
      targetReached: true,
      matching: "fullTargetSurface",
      normalCompatibility: true,
    });
    expect(fitted.overlapRms).toBeLessThan(0.05);
    expect(fitted.wholeCloudRms).toBeGreaterThan(1);
    expect(Math.hypot(...fitted.transform.translation)).toBeLessThan(0.1);
    expect(digest()).toEqual(original);
  },
  300000,
);
