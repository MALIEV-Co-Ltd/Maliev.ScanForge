import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { freemem } from "node:os";
import oracle from "./fixtures/global-fine-canonical-controller-native.json";
import targetOracle from "./fixtures/global-fine-retained-owner-mesh-native.json";
import { createGlobalQueryWorkerState } from "../src/scan-global-query-worker";
import {
  globalQueryInputBytes,
  shareGlobalQueryInput,
} from "../src/scan-global-query-storage";

const directory = process.env.SCANFORGE_BOUNDED_OWNER_TARGETS;
const hash = (value: ArrayBufferView) =>
  createHash("sha256")
    .update(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
    .digest("hex");

it.skipIf(!directory)(
  "prepares all three complete native targets under one enforced pool allocation budget",
  () => {
    if (freemem() < 4096 * 1048576)
      throw Error("Owner preparation requires 4096 MiB free.");
    const scans = oracle.scene.sources.map((source, i) => {
      const p = readFileSync(directory + "/" + source.pointsCarrier),
        n = readFileSync(directory + "/" + source.normalsCarrier),
        t = readFileSync(directory + "/" + source.trianglesCarrier);
      expect(hash(p)).toBe(source.pointsSha256);
      expect(hash(n)).toBe(source.normalsSha256);
      expect(hash(t)).toBe(source.trianglesSha256);
      const points = new Float32Array(p.buffer, p.byteOffset, p.byteLength / 4);
      return {
        id: String(i),
        geometry: {
          points,
          normals: new Float32Array(n.buffer, n.byteOffset, n.byteLength / 4),
          labels: new Uint32Array(points.length / 3),
          rawTargetIds: new Uint32Array(),
          targetMeshes: [
            {
              vertices: points,
              triangles: new Uint32Array(
                t.buffer,
                t.byteOffset,
                t.byteLength / 4,
              ),
              packedNodes: true,
              compactBounds: true,
            },
          ],
        },
      };
    });
    const input = { scans },
      reserved = globalQueryInputBytes(input, 2, true) + 48 * 1048576;
    const started = performance.now(),
      before = process.memoryUsage();
    const state = createGlobalQueryWorkerState({
      ...shareGlobalQueryInput(input),
      exportPreparedMeshes: true,
      storageBudget: { limit: 512 * 1048576, reserved },
    });
    const targets = state.prepared!.preparedMeshes!;
    const comparisons = [];
    for (let i = 0; i < 3; i++) {
      const actual = targets[i].targets[0],
        expected = targetOracle.cases[i],
        index = actual.packedIndex!;
      expect(hash(actual.neighbours)).toBe(
        oracle.builds[i].neighborMasksSha256,
      );
      expect(hash(actual.surface.normals)).toBe(expected.facetNormalsSha256);
      const digest = createHash("sha256");
      for (let id = 0; id < index.links.length / 12; id++) {
        const base = id * 12,
          offset = index.links[base + 8],
          count = index.links[base + 9];
        let mask = 0;
        for (let child = 0; child < 8; child++)
          if (index.links[base + child]) mask |= 1 << child;
        const header = Uint32Array.of(
          index.links[base + 10],
          index.links[base + 11],
          mask,
          count,
        );
        digest.update(
          Buffer.from(
            index.values.buffer,
            index.values.byteOffset + base * 8,
            96,
          ),
        );
        digest.update(Buffer.from(header.buffer));
        digest.update(
          Buffer.from(
            index.memberships.buffer,
            index.memberships.byteOffset + offset * 4,
            count * 4,
          ),
        );
      }
      expect(digest.digest("hex")).toBe(expected.indexSha256);
      comparisons.push({
        scan: expected.sourceFile,
        nodes: index.links.length / 12,
        memberships: index.memberships.length,
      });
    }
    expect(state.storage!.peak).toBeLessThanOrEqual(512 * 1048576);
    writeFileSync(
      ".resources/global-bounded-owner-targets.json",
      JSON.stringify(
        {
          elapsedMs: performance.now() - started,
          before,
          after: process.memoryUsage(),
          storage: state.storage,
          comparisons,
          originalSourceIdentityRechecked: false,
          physicalWorkerVerified: false,
        },
        null,
        2,
      ),
    );
  },
  150000,
);
