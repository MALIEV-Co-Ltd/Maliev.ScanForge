import { describe, expect, it } from "vitest";
import {
  beginSurfaceFit,
  acceptSurfaceFit,
  surfaceFitEntity,
} from "../src/surface-fit-session";
import {
  createGridPatch,
  fitGridSurface,
  parsePatch,
  serializePatch,
} from "../src/surfaces";
import { modelChanged } from "../src/history";
import type { Entity } from "../src/types";

const source: Entity = {
  id: "scan",
  name: "Scan",
  kind: "mesh",
  visible: true,
  opacity: 0.6,
  color: "#aaa",
  positions: new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 9, 0, 0, 10, 0, 0, 9, 1, 0, 19, 0, 0, 20, 0, 0,
    19, 1, 0,
  ]),
};
describe("staged surface fitting", () => {
  it("freezes only selected visible triangles and preserves the source", () => {
    const mask = new Uint8Array([1, 1, 0]);
    const session = beginSurfaceFit(source, mask, [1]);
    expect(session.triangles).toBe(1);
    expect(Array.from(session.scan)).toEqual(
      Array.from(source.positions.slice(0, 9)),
    );
    mask.fill(0);
    expect(session.scan.length).toBe(9);
    expect(session.scan).not.toBe(source.positions);
    expect(() => beginSurfaceFit(source, mask, [])).toThrow(/Select a visible/);
    expect(() => beginSurfaceFit(source, new Uint8Array(1), [])).toThrow(
      /does not match/,
    );
    expect(() => beginSurfaceFit({ ...source, kind: "cad" }, mask, [])).toThrow(
      /triangle scan/,
    );
  });
  it("preview and cancellation leave model unchanged, acceptance adds one persistable linked surface", () => {
    const session = beginSurfaceFit(source, new Uint8Array([1, 0, 0]), []);
    const entities = [source];
    expect(() => acceptSurfaceFit(session, entities, "out")).toThrow(/Apply/);
    const preview = {
      patch: createGridPatch(4, 4, 1, 1, 3),
      samples: 16,
      rms: 0,
      maxError: 0,
      projection: "xy" as const,
      solverBytes: 4096,
    };
    const staged = { ...session, preview };
    const transient = surfaceFitEntity(staged, "preview");
    expect(entities).toEqual([source]);
    expect(transient.surfaceScanId).toBe(source.id);
    const next = acceptSurfaceFit(staged, entities, "out");
    expect(modelChanged(entities, next)).toBe(true);
    expect(next[0]).toBe(source);
    expect(next[1].surfacePatch).toEqual(
      parsePatch(serializePatch(preview.patch)),
    );
    expect(next[1].color).not.toBe(source.color);
    expect(() =>
      acceptSurfaceFit(
        staged,
        [{ ...source, positions: source.positions.slice() }],
        "out",
      ),
    ).toThrow(/scan changed/);
  });
  it("fits the frozen region rather than an unselected spatial outlier", () => {
    const positions: number[] = [];
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 5; x++)
        positions.push(
          x,
          y,
          2 * x + 3 * y,
          x + 1,
          y,
          2 * (x + 1) + 3 * y,
          x,
          y + 1,
          2 * x + 3 * (y + 1),
        );
    positions.push(1000, 1000, 1000, 1001, 1000, 1000, 1000, 1001, 1000);
    const scan = { ...source, positions };
    const mask = new Uint8Array(26).fill(1);
    mask[25] = 0;
    const frozen = beginSurfaceFit(scan, mask, []);
    const fit = fitGridSurface(frozen.scan, {
      countU: 4,
      countV: 4,
      degree: 3,
      projection: "xy",
      sampleLimit: 1000,
    });
    expect(fit.maxError).toBeLessThan(0.001);
    expect(Math.max(...fit.patch.points.map((p) => p[0]))).toBeLessThan(7);
  });
});
