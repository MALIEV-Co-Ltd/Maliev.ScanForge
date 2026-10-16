import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { freemem } from "node:os";
import fixture from "./fixtures/global-fine-retained-owner-source-native.json";
import targets from "./fixtures/global-fine-retained-owner-mesh-native.json";
import { noiseNormals } from "../src/scan-native-noise";

const directory = process.env.SCANFORGE_NATIVE_OWNER_SOURCE;
const hash = (bytes: ArrayBufferView) =>
  createHash("sha256")
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest("hex");
it("binds the native source normals to the same complete evaluator input carriers", () => {
  expect(fixture.provenance.imageSha256).toBe(targets.provenance.imageSha256);
  expect(fixture.provenance.fullRegistrationVerified).toBe(false);
  expect(fixture.cases).toHaveLength(3);
  for (const [id, source] of fixture.cases.entries()) {
    const target = targets.cases[id];
    for (const key of [
      "sourceFile",
      "vertices",
      "triangles",
      "verticesSha256",
      "trianglesSha256",
      "indexSha256",
      "facetNormalsSha256",
      "neighborMasksSha256",
    ] as const)
      expect(source[key]).toBe(target[key]);
    expect(source.evaluatorQueryControls).toBe(target.queries.length);
    expect(source.originalSourceIdentityRechecked).toBe(false);
  }
});
it.skipIf(!directory).each(fixture.cases)(
  "matches original complete source-normal bits: $id",
  (c) => {
    if (freemem() < 4096 * 1048576)
      throw Error("Retained owner source normals require 4096 MiB free.");
    const vb = readFileSync(resolve(directory!, c.verticesCarrier));
    const tb = readFileSync(resolve(directory!, c.trianglesCarrier));
    const original = readFileSync(resolve(directory!, c.vertexNormalsCarrier));
    expect(hash(vb)).toBe(c.verticesSha256);
    expect(hash(tb)).toBe(c.trianglesSha256);
    expect(hash(original)).toBe(c.vertexNormalsSha256);
    const vertices = new Float32Array(
      vb.buffer,
      vb.byteOffset,
      vb.byteLength / 4,
    );
    const triangles = new Uint32Array(
      tb.buffer,
      tb.byteOffset,
      tb.byteLength / 4,
    );
    expect(vertices.length).toBe(c.vertices * 3);
    expect(triangles.length).toBe(c.triangles * 3);
    const deadline = performance.now() + 90000;
    const signal = {
      get aborted() {
        return performance.now() > deadline || freemem() < 1024 * 1048576;
      },
    } as AbortSignal;
    const normals = noiseNormals({ vertices, triangles }, { signal });
    expect(normals.length * 4).toBe(original.byteLength);
    expect(hash(normals)).toBe(c.vertexNormalsSha256);
  },
  120000,
);
