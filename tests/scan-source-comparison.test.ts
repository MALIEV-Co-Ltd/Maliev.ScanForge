import { expect, it } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import { createScanBudget } from "../src/scan-resource-budget";
import { createMemoryPageStore } from "../src/scan-memory-page-store";
import { residentScanSource } from "../src/scan-resident-source";
import { createScanSampleDirectory } from "../src/scan-sample-directory";
import {
  scanDirectoryEntries,
  scanDirectoryWriter,
} from "../src/scan-page-directory";
import { preparePagedReductionSurface } from "../src/scan-paged-surface-index";
import { compareScanSources } from "../src/scan-source-comparison";
import { compareReductionSurface } from "../src/scan-reduction-comparison";
import type { ScanReductionManifest } from "../src/scan-geometry-source";

it("preserves recovered sample reports and corner colors through paged comparison", async () => {
  const budget = createScanBudget(65_536, 0),
    store = createMemoryPageStore(budget, "comparison");
  const original = [
    0, 0, 0.01, 1, 0, 0.02, 0, 1, -0.02, 0, 0, 0.01, 0, 1, -0.02, -1, 0, 0,
  ];
  const source = residentScanSource(
    original,
    { id: "source", generation: 1 },
    budget,
  );
  const samples = await createScanSampleDirectory(source, store, budget);
  const reduced = new Float32Array([-2, -2, 0, 4, -2, 0, -2, 4, 0]);
  const chunks = scanDirectoryWriter(store, budget);
  await chunks.append({
    first: 0,
    count: 1,
    page: await store.append(new Uint8Array(reduced.buffer)),
  });
  const manifest: ScanReductionManifest = {
    source: source.metadata.ref,
    ref: { id: "out", generation: 1 },
    chunks: await chunks.finish(),
    triangles: 1,
    targetTriangles: 1,
    bounds: [-2, -2, 0, 4, 4, 0],
    precision: "float32",
    protectedPatches: 0,
    protectedSourceTriangles: 0,
  };
  const index = await preparePagedReductionSurface(manifest, store, budget);
  try {
    const result = await compareScanSources(samples, index, 0.05, 0.05, {
      store,
      budget,
      progress() {},
    });
    const topology = analyzeMesh(original, { tolerance: 1e-6 });
    const expected = compareReductionSurface(
      topology.vertices,
      { coordinates: reduced, indices: new Uint32Array([0, 1, 2]) },
      0.05,
      0.05,
    );
    expect(result.statistics).toEqual(expected.statistics);
    const rgb: number[] = [];
    for await (const entry of scanDirectoryEntries(
      result.colors,
      store,
      budget,
    )) {
      const page = await store.read(entry.page);
      try {
        rgb.push(...page.bytes);
      } finally {
        page.release();
      }
    }
    expect(rgb).toEqual(
      [...topology.triangles].flatMap((id) => [
        ...expected.rgb.subarray(id * 3, id * 3 + 3),
      ]),
    );
    expect(budget.snapshot().peakBytes).toBeLessThanOrEqual(65_536);
  } finally {
    index.dispose();
  }
});
