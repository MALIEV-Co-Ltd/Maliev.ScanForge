import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";

// The captured records in this control have zero or one 32-bit magnitude limb.
// This deliberately does not infer the representation of longer native values.
function value(hex: string) {
  const bytes = Buffer.from(hex, "hex");
  const sign = bytes.readInt32LE(0),
    exponent = bytes.readInt32LE(4);
  const limbs = bytes.readUInt32LE(12),
    magnitude = bytes.readUInt32LE(16);
  expect([0, 1]).toContain(limbs);
  if (limbs === 0) {
    expect(sign).toBe(0);
    return 0;
  }
  expect(sign).toBe(1);
  return magnitude * 2 ** exponent;
}
function distance(p: number[], a: number[], b: number[]) {
  const x = b[0] - a[0],
    y = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * y) / (x * x + y * y)),
  );
  return Math.hypot(p[0] - a[0] - t * x, p[1] - a[1] - t * y);
}
it("checks the three observed native choices against their captured point records", () => {
  const trace = JSON.parse(
    readFileSync(
      new URL(
        "../docs/evidence/m2-split-native-pivot-points-20261107.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(trace.normalized_result.messages_truncated).toBe(false);
  const choices = trace.normalized_result.messages
    .map((m: { payload: any }) => m.payload)
    .filter((p: { event: string }) => p.event === "pivot");
  expect(choices).toHaveLength(3);
  const exported = readFileSync(
    new URL(
      "./fixtures/m2-crossing-pivot-native-20261107/native-result.stl",
      import.meta.url,
    ),
  );
  const mesh = parseMesh(
    exported.buffer.slice(
      exported.byteOffset,
      exported.byteOffset + exported.byteLength,
    ),
    "stl",
  );
  const vertices = new Set<string>();
  for (let i = 0; i < mesh.length; i += 3)
    vertices.add(`${mesh[i]},${mesh[i + 1]}`);
  for (const c of choices) {
    expect(c.end - c.start).toBe(3);
    const p = c.records.map((r: { part0: string; part1: string }) => [
      value(r.part0),
      value(r.part1),
    ]);
    for (const point of p) expect(vertices.has(point.join(","))).toBe(true);
    const scores = [distance(p[1], p[0], p[3]), distance(p[2], p[0], p[3])];
    expect(scores[0]).toBeLessThan(scores[1]);
    expect(c.result).toBe(c.start + 1);
  }
});

it("binds both native recovery calls to the two crossing segments", () => {
  const trace = JSON.parse(
    readFileSync(
      new URL(
        "../docs/evidence/m2-split-native-edge-points-20261107.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(trace.normalized_result.messages_truncated).toBe(false);
  const events = trace.normalized_result.messages
    .map((m: { payload: any }) => m.payload)
    .filter((p: { event: string }) => p.event === "edge");
  expect(events.map((e: { ids: number[] }) => e.ids)).toEqual([
    [3, 4],
    [5, 6],
  ]);
  const points = events.map(
    (e: { points: { part0: string; part1: string }[] }) =>
      e.points.map((p) => [value(p.part0), value(p.part1)]),
  );
  const expected = [
    [
      [0, 0.8210515379905701],
      [0.47950512170791626, 0.22795704007148743],
    ],
    [
      [0.30589231848716736, 0.45892637968063354],
      [0.12946633994579315, 0.34272921085357666],
    ],
  ];
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++)
      for (let k = 0; k < 2; k++)
        expect(points[i][j][k]).toBeCloseTo(expected[i][j][k], 7);
});

it("records the second native recovery replacing the first crossing edge", () => {
  const trace = JSON.parse(
    readFileSync(
      new URL(
        "../docs/evidence/m2-split-native-face-transitions-20261107.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(trace.normalized_result.messages_truncated).toBe(false);
  const calls = trace.normalized_result.messages
    .map((m: { payload: any }) => m.payload)
    .filter((p: { event: string }) => p.event === "recovery");
  expect(calls).toHaveLength(2);
  expect(calls.map((c: { pair: string }) => c.pair)).toEqual([
    "0x400000003",
    "0x600000005",
  ]);
  const hasEdge = (faces: number[][], a: number, b: number) =>
    faces.some((t) => t.includes(a) && t.includes(b));
  expect(hasEdge(calls[0].before, 3, 4)).toBe(false);
  expect(hasEdge(calls[0].after, 3, 4)).toBe(true);
  expect(calls[1].before).toEqual(calls[0].after);
  expect(hasEdge(calls[1].after, 3, 4)).toBe(false);
  expect(hasEdge(calls[1].after, 5, 6)).toBe(true);
});

it("traces the native initial triangulation through both strip recoveries", () => {
  const trace = JSON.parse(
    readFileSync(
      new URL(
        "../docs/evidence/m2-split-native-recovery-stages-20261107.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(trace.normalized_result.messages_truncated).toBe(false);
  const events = trace.normalized_result.messages
    .map((m: { payload: any }) => m.payload)
    .filter((p: { event: string }) =>
      ["initial", "recover", "strip"].includes(p.event),
    );
  expect(events.map((e: { event: string }) => e.event)).toEqual([
    "initial",
    "strip",
    "recover",
    "strip",
    "recover",
  ]);
  const [initial, strip1, recover1, strip2, recover2] = events;
  expect(initial.before).toEqual([]);
  expect(initial.after).toEqual(strip1.before);
  expect(strip1.after).toEqual(recover1.after);
  expect(strip2.before).toEqual(recover1.after);
  expect(strip2.after).toEqual(recover2.after);
  const canonical = (faces: number[][]) =>
    faces.map((t) => [...t].sort((a, b) => a - b).join(",")).sort();
  expect(canonical(recover2.after)).toEqual(canonical(initial.after));
  expect(strip1.arg2).toBe("0x6");
  expect(strip1.arg3).toBe("0x5");
  expect(strip2.arg2).toBe("0x3");
  expect(strip2.arg3).toBe("0x4");
});
