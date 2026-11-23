import { expect, it } from "vitest";
import { buildFiniteFaceInput } from "../src/scan-split-finite-face-input";
import type { Vec3 } from "../src/types";
it("matches brute-force unique rounded-distance association across coordinate scales", () => {
  let seed = 0x3471b2c1;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const radius = Math.fround(0.0001);
  for (let trial = 0; trial < 300; trial++) {
    const origin = [0, 1, -1, 1000, -1000, 1e6, -1e6, 1e12][trial % 8];
    const p: Vec3 = [
      origin + (random() - 0.5) * 0.0003,
      origin + (random() - 0.5) * 0.0003,
      origin + (random() - 0.5) * 0.0003,
    ];
    const registered = ([0, 1, 2] as const).map((edge) => ({
      edge: [edge, (edge + 1) % 3] as [number, number],
      contacts: Array.from({ length: 12 }, (_, i) => {
        const t = (i + 1) / 13;
        return {
          t,
          point: [
            p[0] + (random() - 0.5) * 0.0004,
            p[1] + (random() - 0.5) * 0.0004,
            p[2] + (random() - 0.5) * 0.0004,
          ] as Vec3,
          canonical: { t, reversed: false },
        };
      }),
    }));
    const flat = registered.flatMap((r) => r.contacts);
    const matches = flat.flatMap((c, i) =>
      Math.hypot(...c.point.map((v, k) => Math.fround(v) - Math.fround(p[k]))) <
      radius
        ? [i]
        : [],
    );
    const hit = {
      points: [p, [p[0] + 100, p[1] + 100, p[2] + 100] as Vec3],
      coplanar: false,
      sourceEdges: [[], []],
    };
    const out = buildFiniteFaceInput([0, 1, 2], [hit], registered, {
      preciseCoordinates: true,
    });
    const bound = out.endpointBindings.filter(
      (b) => b.segment === 0 && b.endpoint === 0,
    );
    expect(bound, `trial ${trial}`).toEqual(
      matches.length === 1
        ? [{ segment: 0, endpoint: 0, contact: matches[0] }]
        : [],
    );
  }
});
