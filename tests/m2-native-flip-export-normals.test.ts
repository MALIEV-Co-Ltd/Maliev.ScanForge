import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { nativeStlTopology } from "../src/scan-native-stl-topology";
import { flipScanNormals } from "../src/scan-tools-transforms";

const sourcePath = process.env.SCANFORGE_M2_FIRST_STL;
const nativePath = process.env.SCANFORGE_M2_FLIP_NATIVE_STL;
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
it.skipIf(!sourcePath)(
  "reconstructs the recorded native STL normal stream from indexed Flip normals",
  () => {
    const file = readFileSync(sourcePath!);
    const native = nativePath ? readFileSync(nativePath) : undefined;
    expect(hash(file)).toBe(
      "6dfc4db5ed4ad2ed5c2f9295a11c50c2dda5db3240cd82ce80c1d1f3e38af6c9",
    );
    if (native)
      expect(hash(native)).toBe(
        "bb998c42328bdcc30d1ebd317d0af603213a0f9236e8307f8e6279a858a4133d",
      );
    const source = parseMesh(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
      "stl",
    );
    const result = flipScanNormals(source, {
      sourceTopology: nativeStlTopology(source),
    });
    const mesh = result.indexedMesh!;
    const normals = mesh.geometryNormals!;
    expect(
      hash(
        new Uint8Array(normals.buffer, normals.byteOffset, normals.byteLength),
      ),
    ).toBe("d7d85da0137d48dac79f4ff157d91dfd0ba87a166a339e8eb671d3dad71cf84c");
    const derived = new Float32Array(mesh.triangles.length);
    const f = Math.fround;
    let exact = 0,
      maxDifference = 0,
      sumSquared = 0;
    for (let i = 0; i < mesh.triangles.length; i += 3) {
      const nativeOffset = 84 + (i / 3) * 50;
      for (let k = 0; k < 3; k++) {
        const value = f(
          f(
            f(
              normals[mesh.triangles[i] * 3 + k] +
                normals[mesh.triangles[i + 1] * 3 + k],
            ) + normals[mesh.triangles[i + 2] * 3 + k],
          ) / 3,
        );
        derived[i + k] = value;
        if (native) {
          const n = native.readFloatLE(nativeOffset + k * 4);
          const delta = value - n;
          if (!Number.isFinite(delta))
            throw new Error(`Invalid normal at component ${i + k}`);
          if (Object.is(value, n)) exact++;
          maxDifference = Math.max(maxDifference, Math.abs(delta));
          sumSquared += delta * delta;
        }
      }
    }
    expect(derived.length).toBe(819417);
    expect(hash(new Uint8Array(derived.buffer))).toBe(
      "0f562055b81f54e5bdfb3b9169df8e22d291844e21b4176e7e1586b34bacb984",
    );
    if (native) {
      expect(exact).toBe(derived.length);
      expect(maxDifference).toBe(0);
      expect(sumSquared).toBe(0);
    }
  },
  120000,
);
