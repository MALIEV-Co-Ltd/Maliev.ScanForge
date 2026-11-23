import { it, expect } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { readScan, type ImportedIndexedMesh } from "../src/import-parser";
const receipt = process.env.SCANFORGE_ALIGNMENT_VALIDATION_RECEIPT;
const folder = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
const hash = (v: ArrayBufferView) =>
  createHash("sha256")
    .update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))
    .digest("hex");
function transform(input: Float32Array, m: readonly number[]) {
  const result = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 3) {
    const x = input[i],
      y = input[i + 1],
      z = input[i + 2];
    for (let a = 0; a < 3; a++)
      result[i + a] =
        m[a * 4] * x + m[a * 4 + 1] * y + m[a * 4 + 2] * z + m[a * 4 + 3];
  }
  return result;
}
it.skipIf(!receipt || !folder)(
  "independently reproduces all original STL coordinate stages against public MCP hashes",
  async () => {
    const r = JSON.parse(await readFile(receipt!, "utf8")),
      out = join(dirname(receipt!), "quality-inputs");
    await mkdir(out, { recursive: true });
    const scans: {
      id: string;
      name: string;
      inputSha256: string;
      vertices: number;
      triangles: number;
      trianglePath: string;
      original: string;
      coarse: string;
      global: string;
      cadBounds: { min: number[]; max: number[] };
      verifiedCoordinateValues: number;
    }[] = [];
    for (const obj of r.before.objects) {
      const file = await readFile(join(folder!, obj.name));
      let indexed: ImportedIndexedMesh | undefined;
      const raw = await readScan(
        {
          size: file.length,
          arrayBuffer: async () =>
            file.buffer.slice(
              file.byteOffset,
              file.byteOffset + file.byteLength,
            ),
          slice: (start = 0, end = file.length) => ({
            arrayBuffer: async () =>
              file.buffer.slice(file.byteOffset + start, file.byteOffset + end),
          }),
        },
        "stl",
        {
          onIndexedMesh: (mesh) => {
            indexed = mesh;
          },
        },
      );
      expect(indexed).toBeDefined();
      const mesh = indexed!;
      const digest = (stage: string, path: string) =>
        r[stage]
          .find((d: any) => d.entityId === obj.id)
          .buffers.find((b: any) => b.path === path);
      expect(hash(raw)).toBe(digest("baselineDigests", "positions").sha256);
      expect(hash(mesh.vertices)).toBe(
        digest("baselineDigests", "indexedMesh.vertices").sha256,
      );
      expect(hash(mesh.triangles)).toBe(
        digest("baselineDigests", "indexedMesh.triangles").sha256,
      );
      const prefix = obj.name.replace(/[^a-z0-9-]/gi, "_");
      const write = async (name: string, array: Float32Array | Uint32Array) => {
        const path = join(out, prefix + "-" + name + ".bin");
        await writeFile(
          path,
          new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
        );
        return path;
      };
      const triangles = await write("triangles", mesh.triangles),
        original = await write("original", mesh.vertices);
      const coarse = r.final.initialization.fits.find(
        (p: any) => p.id === obj.id,
      );
      let points = mesh.vertices,
        positions = raw;
      if (obj.id !== r.final.initialization.anchorId) {
        points = transform(points, coarse.matrix);
        positions = transform(positions, coarse.matrix);
      }
      const coarsePath = await write("coarse", points);
      const applications = r.final.outer.applications.filter(
        (p: any) => p.id === obj.id,
      );
      expect(applications).toHaveLength(2);
      for (const stage of applications) {
        points = transform(points, stage.matrix);
        positions = transform(positions, stage.matrix);
      }
      const finishing = r.final.surfaceRefinement?.fits.find(
        (f: any) => f.id === obj.id,
      );
      if (finishing && obj.id !== r.final.surfaceRefinement.anchorId) {
        points = transform(points, finishing.matrix);
        positions = transform(positions, finishing.matrix);
      }
      expect(hash(points)).toBe(
        digest("globalDigests", "indexedMesh.vertices").sha256,
      );
      expect(hash(positions)).toBe(digest("globalDigests", "positions").sha256);
      const globalPath = await write("global", points);
      points = transform(points, r.cadApplied.matrix);
      positions = transform(positions, r.cadApplied.matrix);
      expect(hash(points)).toBe(
        digest("cadDigests", "indexedMesh.vertices").sha256,
      );
      expect(hash(positions)).toBe(digest("cadDigests", "positions").sha256);
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < points.length; i++) {
        const a = i % 3;
        min[a] = Math.min(min[a], points[i]);
        max[a] = Math.max(max[a], points[i]);
      }
      scans.push({
        id: obj.id,
        name: obj.name,
        inputSha256: createHash("sha256").update(file).digest("hex"),
        vertices: points.length / 3,
        triangles: mesh.triangles.length / 3,
        trianglePath: triangles,
        original,
        coarse: coarsePath,
        global: globalPath,
        cadBounds: { min, max },
        verifiedCoordinateValues: points.length + positions.length,
      });
    }
    const low = [0, 1, 2].map((a) =>
        Math.min(...scans.map((s) => s.cadBounds.min[a])),
      ),
      high = [0, 1, 2].map((a) =>
        Math.max(...scans.map((s) => s.cadBounds.max[a])),
      );
    expect(low[2]).toBeCloseTo(0, 4);
    expect(low[0] + high[0]).toBeCloseTo(0, 4);
    expect(low[1] + high[1]).toBeCloseTo(0, 4);
    await writeFile(
      join(out, "manifest.json"),
      JSON.stringify(
        {
          passed: true,
          receipt,
          scans,
          cadBounds: { min: low, max: high },
          scope:
            "Input import through shared parser verified against browser baseline hashes; independently coded literal Float32 stage arithmetic verified every expanded/indexed coordinate against committed MCP hashes. Independent surface measurement consumes the emitted full indexed meshes.",
        },
        null,
        2,
      ),
    );
  },
  180000,
);
