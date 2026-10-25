import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { endianness, freemem } from "node:os";
import fixture from "./fixtures/global-fine-live-post-owner-native.json";
import { parsePackedBinaryPly } from "../src/ply-binary-topology";
import { transformDatumCoordinateStages } from "../src/datum-transform-kernel";
import { nativeGlobalInvertRigid } from "../src/scan-native-global-outer";
import { noiseNormals } from "../src/scan-native-noise";
import { nativeGlobalFacetNormals } from "../src/scan-native-global-surface";

const directory = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
const decode = (hex: string) => {
  const bytes = Buffer.from(hex, "hex");
  return Array.from({ length: 12 }, (_, i) => bytes.readDoubleLE(i * 8));
};
const hash = (value: Float32Array | Uint32Array) =>
  createHash("sha256")
    .update(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
    .digest("hex");

it.skipIf(!directory).each(fixture.cases)(
  "matches every native live post-state element for $name",
  (c) => {
    if (freemem() < 3072 * 1048576)
      throw Error("Full native post-state replay requires 3072 MiB free.");
    expect(endianness()).toBe("LE");
    const file = readFileSync(directory + "/" + c.name);
    expect(createHash("sha256").update(file).digest("hex")).toBe(c.fileSha256);
    const input =
      file.byteOffset === 0 && file.byteLength === file.buffer.byteLength
        ? file.buffer
        : file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const parsed = parsePackedBinaryPly(input);
    expect(parsed).toBeDefined();
    if (!parsed) throw Error("Pinned scanner PLY layout is required.");
    expect(parsed.vertices.length).toBe(c.vertices * 3);
    expect(parsed.triangles.length).toBe(c.facets * 3);
    const gauge = fixture.cases.find(
      (scan) => scan.descriptorAlias === fixture.gaugeAlias,
    )!;
    const inverse = nativeGlobalInvertRigid(decode(gauge.matrixBits));
    expect(Buffer.from(new Float64Array(inverse).buffer).toString("hex")).toBe(
      fixture.inverseGaugeBits,
    );
    const stages = [decode(c.matrixBits), inverse];
    expect(hash(parsed.triangles)).toBe(c.nativeSha256.topology);
    expect(hash(transformDatumCoordinateStages(parsed.vertices, stages))).toBe(
      c.nativeSha256.positions,
    );
    expect(
      hash(transformDatumCoordinateStages(noiseNormals(parsed), stages, true)),
    ).toBe(c.nativeSha256.derivedNormals);
    expect(
      hash(
        transformDatumCoordinateStages(
          nativeGlobalFacetNormals(parsed.vertices, parsed.triangles).normals,
          stages,
          true,
        ),
      ),
    ).toBe(c.nativeSha256.facetNormals);
  },
  60_000,
);
