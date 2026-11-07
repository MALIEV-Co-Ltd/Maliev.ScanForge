import { BoxGeometry, PlaneGeometry } from "three";
import { it, expect } from "vitest";
import { initializeGlobalSamples } from "../src/global-alignment-initialization-core";
import { sampleGlobalInitialization } from "../src/global-alignment-initialization";
import type { Entity } from "../src/types";
it("finds automatic poses for an asymmetric rigidly moved sample without changing source samples", () => {
  const fixed = Float32Array.from(
    Array.from({ length: 90 }, (_, i) => [
      Math.sin(i * 0.7) * 3 + i / 40,
      Math.cos(i * 0.19) * 2,
      i / 15 + Math.sin(i * 0.3),
    ]).flat(),
  );
  const moved = Float32Array.from(
    Array.from({ length: fixed.length / 3 }, (_, i) => [
      -fixed[i * 3 + 1] + 20,
      fixed[i * 3] - 7,
      fixed[i * 3 + 2] + 4,
    ]).flat(),
  );
  const before = moved.slice(),
    frames: unknown[] = [];
  const result = initializeGlobalSamples(
    [
      { id: "fixed", points: fixed },
      { id: "moving", points: moved },
    ],
    (p) => frames.push(p),
  );
  expect(result.fits[1].rms).toBeLessThan(0.00001);
  expect(moved).toEqual(before);
  expect(frames).toHaveLength(1);
  expect(result.anchorId).toBe("fixed");
});
it("bounds coarse samples and keeps the largest complete scan as the anchor", () => {
  const entity = (id: string, triangles: number) =>
    ({ id, positions: new Float32Array(triangles * 9) }) as Entity;
  const samples = sampleGlobalInitialization([
    entity("partial", 20),
    entity("full", 10000),
  ]);
  expect(samples.map((s) => s.id)).toEqual(["full", "partial"]);
  expect(samples[0].points.length).toBe(18000);
  expect(samples[1].points.length).toBe(60);
});
it("rejects duplicate or unbounded initialization packets", () => {
  const scan = { id: "x", points: new Float32Array(9) };
  expect(() => initializeGlobalSamples([scan, scan])).toThrow(/distinct/);
  expect(() =>
    initializeGlobalSamples([
      scan,
      { id: "y", points: new Float32Array(18003) },
    ]),
  ).toThrow(/bounded/);
});

it("chooses surface coverage rather than tessellation density for the automatic anchor", () => {
  const entity = (id: string, g: BoxGeometry | PlaneGeometry) => {
    const p = g.attributes.position.array,
      t = g.index!.array;
    const expanded = new Float32Array(t.length * 3);
    for (let i = 0; i < t.length; i++)
      for (let a = 0; a < 3; a++) expanded[i * 3 + a] = p[Number(t[i]) * 3 + a];
    g.dispose();
    return { id, positions: expanded } as Entity;
  };
  const complete = entity("complete", new BoxGeometry(20, 10, 4)),
    densePartial = entity("dense-partial", new PlaneGeometry(10, 10, 30, 30));
  expect(densePartial.positions.length).toBeGreaterThan(
    complete.positions.length,
  );
  expect(sampleGlobalInitialization([densePartial, complete])[0].id).toBe(
    "complete",
  );
});
