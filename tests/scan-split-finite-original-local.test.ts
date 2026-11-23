/// <reference types="node" />
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { parsePlyTopology } from "../src/ply-topology";
import { refineFiniteCutterMesh } from "../src/scan-split-finite-pipeline";
import { groupFiniteTrianglesCompact } from "../src/scan-split-finite-group";
import { expandFiniteGroups } from "../src/scan-split-finite-output";
import { materializeFiniteSeams } from "../src/scan-split-finite-seams";
import { partitionFiniteIndexedParts } from "../src/scan-split-finite-parts";
import { indexedMeshMatches } from "../src/indexed-mesh";
import { expandFiniteSeamedMesh } from "../src/scan-split-single-candidate";

it.skipIf(!process.env.SCANFORGE_M2_ORIGINAL_PLY)(
  "runs a full original indexed scan through finite refinement",
  () => {
    const bytes = readFileSync(process.env.SCANFORGE_M2_ORIGINAL_PLY!);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const mesh = parsePlyTopology(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const bounds = [
      Infinity,
      Infinity,
      Infinity,
      -Infinity,
      -Infinity,
      -Infinity,
    ];
    for (let i = 0; i < mesh.vertices.length; i += 3)
      for (let k = 0; k < 3; k++) {
        bounds[k] = Math.min(bounds[k], mesh.vertices[i + k]);
        bounds[k + 3] = Math.max(bounds[k + 3], mesh.vertices[i + k]);
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
    const hashArray = (a: Float32Array | Uint32Array) =>
      createHash("sha256")
        .update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
        .digest("hex");
    const before = {
      vertices: hashArray(mesh.vertices),
      triangles: hashArray(mesh.triangles),
      cutter: hashArray(cutter),
    };
    const baselineComponents = new Set(
      groupFiniteTrianglesCompact(mesh.triangles, new Uint32Array()),
    ).size;
    console.log(
      JSON.stringify({
        inputSha256: digest,
        vertices: mesh.vertices.length / 3,
        faces: mesh.triangles.length / 3,
        bounds,
        cutter: [...cutter],
      }),
    );
    const result = refineFiniteCutterMesh(
      mesh.vertices,
      mesh.triangles,
      cutter,
      {
        maxTypedBytes: 512 * 1024 * 1024,
        onProgress: (fraction, stage) => {
          if (fraction === 1) console.log(JSON.stringify({ fraction, stage }));
        },
      },
    );
    const after = {
      vertices: hashArray(mesh.vertices),
      triangles: hashArray(mesh.triangles),
      cutter: hashArray(cutter),
    };
    const resultHashes = {
      triangles: hashArray(result.triangles),
      constraints: hashArray(result.constraints),
      addedVertices: hashArray(result.addedVertices),
      groups: hashArray(result.groups),
    };
    const incidenceCounts = { boundary: 0, separating: 0, nonseparating: 0 };
    for (const edge of result.cutIncidence) incidenceCounts[edge.kind]++;
    console.log(
      JSON.stringify({
        outputTriangles: result.triangles.length / 3,
        cutEdges: result.constraints.length / 2,
        affectedFaces: result.affectedFaces,
        components: new Set(result.groups).size,
        incidenceCounts,
      }),
    );
    expect(result.affectedFaces).toBeGreaterThan(0);
    expect(result.constraints.length).toBeGreaterThan(0);
    expect(result.cutIncidence.length).toBeGreaterThan(0);
    expect(after).toEqual(before);
    const expanded = expandFiniteGroups(
      mesh.vertices,
      result.addedVertices,
      result.triangles,
      result.groups,
      { maxTypedBytes: 512 * 1024 * 1024 },
    );
    expect(expanded.reduce((n, group) => n + group.positions.length, 0)).toBe(
      result.triangles.length * 3,
    );
    const area = (p: Float32Array) => {
      let sum = 0;
      for (let i = 0; i < p.length; i += 9) {
        const ax = p[i + 3] - p[i],
          ay = p[i + 4] - p[i + 1],
          az = p[i + 5] - p[i + 2];
        const bx = p[i + 6] - p[i],
          by = p[i + 7] - p[i + 1],
          bz = p[i + 8] - p[i + 2];
        sum +=
          Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) /
          2;
      }
      return sum;
    };
    const sourceCorners = new Float32Array(mesh.triangles.length * 3);
    for (let i = 0; i < mesh.triangles.length; i++) {
      const base = mesh.triangles[i] * 3;
      sourceCorners.set(mesh.vertices.subarray(base, base + 3), i * 3);
    }
    const inputArea = area(sourceCorners);
    const outputArea = expanded.reduce(
      (n, group) => n + area(group.positions),
      0,
    );
    expect(Math.abs(outputArea - inputArea) / inputArea).toBeLessThan(1e-6);
    if (process.env.SCANFORGE_M2_PRECISE_SEAMS === "1") {
      const allVertices = new Float32Array(
        mesh.vertices.length + result.addedVertices.length,
      );
      allVertices.set(mesh.vertices);
      allVertices.set(result.addedVertices, mesh.vertices.length);
      const precise = materializeFiniteSeams(
        allVertices,
        result.triangles,
        result.constraints,
        {
          preciseCoordinates: true,
          maxTypedBytes: 1024 * 1024 * 1024,
        },
      );
      let preciseArea = 0;
      for (let i = 0; i < precise.triangles.length; i += 3) {
        const a = precise.triangles[i] * 3,
          b = precise.triangles[i + 1] * 3,
          c = precise.triangles[i + 2] * 3;
        const ux = precise.vertices[b] - precise.vertices[a],
          uy = precise.vertices[b + 1] - precise.vertices[a + 1],
          uz = precise.vertices[b + 2] - precise.vertices[a + 2];
        const vx = precise.vertices[c] - precise.vertices[a],
          vy = precise.vertices[c + 1] - precise.vertices[a + 1],
          vz = precise.vertices[c + 2] - precise.vertices[a + 2];
        preciseArea +=
          Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) /
          2;
      }
      const groups = groupFiniteTrianglesCompact(
        precise.triangles,
        new Uint32Array(),
        { maxTypedBytes: 512 * 1024 * 1024 },
      );
      expect(new Set(groups).size).toBe(new Set(result.groups).size);
      expect(Math.abs(preciseArea - inputArea) / inputArea).toBeLessThan(1e-6);
      let partFaces: number[] | undefined;
      if (process.env.SCANFORGE_M2_PRECISE_PARTS === "1") {
        const parts = partitionFiniteIndexedParts(
          precise.vertices,
          precise.triangles,
          groups,
          { maxTypedBytes: 1024 * 1024 * 1024 },
        );
        partFaces = parts.map((part) => part.indexedMesh.triangles.length / 3);
        expect(partFaces.reduce((sum, value) => sum + value, 0)).toBe(
          precise.triangles.length / 3,
        );
        for (const part of parts)
          expect(indexedMeshMatches(part.indexedMesh, part.positions)).toBe(
            true,
          );
      }
      expect(hashArray(mesh.vertices)).toBe(before.vertices);
      expect(hashArray(mesh.triangles)).toBe(before.triangles);
      console.log(
        JSON.stringify({
          preciseVertices: precise.vertices.length / 3,
          preciseTriangles: precise.triangles.length / 3,
          inputArea,
          preciseArea,
        }),
      );
      if (process.env.SCANFORGE_M2_PRECISE_RECEIPT)
        writeFileSync(
          process.env.SCANFORGE_M2_PRECISE_RECEIPT,
          JSON.stringify(
            {
              inputSha256: digest,
              sourceFaces: mesh.triangles.length / 3,
              sourceHashes: before,
              preciseVertices: precise.vertices.length / 3,
              preciseTriangles: precise.triangles.length / 3,
              cutEdges: result.constraints.length / 2,
              groups: new Set(groups).size,
              partFaces,
              inputArea,
              preciseArea,
            },
            null,
            2,
          ),
        );
    }
    if (process.env.SCANFORGE_M2_MATERIALIZE_SEAMS === "1") {
      const allVertices = new Float32Array(
        mesh.vertices.length + result.addedVertices.length,
      );
      allVertices.set(mesh.vertices);
      allVertices.set(result.addedVertices, mesh.vertices.length);
      const seamed = materializeFiniteSeams(
        allVertices,
        result.triangles,
        result.constraints,
        { maxTypedBytes: 512 * 1024 * 1024 },
      );
      const actualGroups = groupFiniteTrianglesCompact(
        seamed.triangles,
        new Uint32Array(),
        { maxTypedBytes: 512 * 1024 * 1024 },
      );
      expect(new Set(actualGroups).size).toBe(new Set(result.groups).size);
      const parts = partitionFiniteIndexedParts(
        seamed.vertices,
        seamed.triangles,
        actualGroups,
        { maxTypedBytes: 512 * 1024 * 1024 },
      );
      expect(parts).toHaveLength(new Set(actualGroups).size);
      for (const part of parts)
        expect(indexedMeshMatches(part.indexedMesh, part.positions)).toBe(true);
      expect(parts.reduce((sum, part) => sum + part.positions.length, 0)).toBe(
        seamed.triangles.length * 3,
      );
      const single = expandFiniteSeamedMesh(seamed, {
        maxTypedBytes: 512 * 1024 * 1024,
      });
      expect(indexedMeshMatches(single.indexedMesh, single.positions)).toBe(
        true,
      );
      expect(
        Math.abs(area(single.positions) - inputArea) / inputArea,
      ).toBeLessThan(1e-6);
      const corners = new Float32Array(seamed.triangles.length * 3);
      for (let i = 0; i < seamed.triangles.length; i++) {
        const base = seamed.triangles[i] * 3;
        corners.set(seamed.vertices.subarray(base, base + 3), i * 3);
      }
      expect(Math.abs(area(corners) - inputArea) / inputArea).toBeLessThan(
        1e-6,
      );
      expect(hashArray(mesh.vertices)).toBe(before.vertices);
      expect(hashArray(mesh.triangles)).toBe(before.triangles);
      console.log(
        JSON.stringify({
          seamedVertices: seamed.vertices.length / 3,
          seamedTriangles: seamed.triangles.length / 3,
        }),
      );
    }
    const sourceCount = mesh.vertices.length / 3;
    for (const id of result.constraints) {
      const actualX =
        id < sourceCount
          ? mesh.vertices[id * 3]
          : result.addedVertices[(id - sourceCount) * 3];
      expect(actualX).toBe(cutter[0]);
    }
    if (process.env.SCANFORGE_M2_RECEIPT)
      writeFileSync(
        process.env.SCANFORGE_M2_RECEIPT,
        JSON.stringify(
          {
            inputSha256: digest,
            vertices: mesh.vertices.length / 3,
            faces: mesh.triangles.length / 3,
            bounds,
            cutter: [...cutter],
            outputTriangles: result.triangles.length / 3,
            cutEdges: result.constraints.length / 2,
            affectedFaces: result.affectedFaces,
            baselineComponents,
            components: new Set(result.groups).size,
            incidenceCounts,
            before,
            after,
            resultHashes,
          },
          null,
          2,
        ),
      );
  },
  120_000,
);
