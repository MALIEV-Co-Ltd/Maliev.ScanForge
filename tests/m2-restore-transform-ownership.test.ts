import { expect, it } from "vitest";
import {
  packProjectTransport,
  unpackProjectTransport,
} from "../src/project-transport";
import { ProjectNumericReuse } from "../src/project-numeric-reuse";
import { runScanTool, type ScanToolOperation } from "../src/scan-tools";
it("preserves a saved numeric source through representative M2 transforms during reuse", async () => {
  const triangle = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const positions = Array.from({ length: 65538 }, (_, i) => triangle[i % 9]);
  const before = positions.slice();
  const packed = await packProjectTransport({ positions });
  const cache = new ProjectNumericReuse(4, 65536);
  cache.remember([positions]);
  let ran = false;
  const out = await unpackProjectTransport<{ positions: number[] }>(
    packed.packet,
    {
      reuseNumericArray: (bytes, used) =>
        cache.match(
          bytes,
          () => {},
          async () => {
            if (ran) return;
            ran = true;
            const operations: ScanToolOperation[] = [
              { kind: "scaleMesh", factor: 2 },
              { kind: "flipNormals" },
              { kind: "mirrorMesh", center: [0, 0, 0], normal: [1, 0, 0] },
            ];
            for (const operation of operations) {
              const result = runScanTool({
                kind: "scanTools",
                positions,
                operation,
              });
              expect(result.positions).not.toBe(positions);
            }
          },
          used,
        ),
      releaseOwnedNumericBuffers: true,
    },
  );
  expect(ran).toBe(true);
  expect(positions).toEqual(before);
  expect(out.positions).toBe(positions);
});
