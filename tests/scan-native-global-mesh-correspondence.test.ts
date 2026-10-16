import { expect, it } from "vitest";
import fixture from "./fixtures/global-fine-mesh-correspondence-native.json";
import { meshCorrespondenceFixture } from "./helpers/global-mesh-correspondence-fixture";
import { nativeGlobalQuery } from "../src/scan-native-global-query";
import { createGlobalQueryWorkerState } from "../src/scan-global-query-worker";
it.each(fixture.cases)(
  "matches original mesh correspondence: $name $mode",
  (c) => {
    const { scans, job } = meshCorrespondenceFixture(c);
    const state = createGlobalQueryWorkerState({ scans });
    for (let repeat = 0; repeat < 2; repeat++) {
      const source = { ...scans[0], matrix: job.poses[0].matrix };
      const result = nativeGlobalQuery({
        ...job,
        source,
        targets: scans
          .slice(1)
          .map((s, i) => ({ ...s, matrix: job.poses[i + 1].matrix })),
      });
      expect(result.count).toBe(c.count);
      const numeric = (pairs: typeof result.pairs) =>
        pairs.map((p) => ({
          id: p.id,
          active: p.active,
          numericBits: Buffer.from(
            Float64Array.from([...p.source, ...p.target, p.distance]).buffer,
          ).toString("hex"),
        }));
      const expected = c.results.map((p) => ({
        id: p.id,
        active: p.active,
        numericBits: p.numericBits,
      }));
      expect(numeric(result.pairs)).toEqual(expected);
      expect(numeric(state.execute(job).pairs)).toEqual(expected);
    }
  },
);
