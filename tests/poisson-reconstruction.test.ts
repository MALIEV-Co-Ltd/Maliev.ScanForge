import { expect, it } from "vitest";
import {
  validatePoissonInput,
  POISSON_MAX_POINTS,
} from "../src/poisson-reconstruction";

const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0],
  normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
it("validates Poisson defaults and trust boundaries before loading WASM", () => {
  expect(validatePoissonInput({ positions, normals })).toMatchObject({
    points: 3,
    depth: 8,
    pointWeight: 2,
    samplesPerNode: 1.5,
    densityThreshold: 0,
  });
  for (const patch of [
    { depth: 5 },
    { depth: 11 },
    { depth: 7.5 },
    { pointWeight: -1 },
    { pointWeight: 101 },
    { samplesPerNode: 0 },
    { samplesPerNode: 101 },
    { densityThreshold: -1 },
    { densityThreshold: 33 },
  ])
    expect(() =>
      validatePoissonInput({ positions, normals, ...patch }),
    ).toThrow();
  expect(() =>
    validatePoissonInput({ positions, normals: [0, 0, 0, 0, 0, 1, 0, 0, 1] }),
  ).toThrow(/normal/i);
  expect(() =>
    validatePoissonInput({ positions: [0, 0, NaN, 1, 0, 0, 0, 1, 0], normals }),
  ).toThrow(/finite/i);
  expect(() =>
    validatePoissonInput({
      positions: new Float32Array((POISSON_MAX_POINTS + 1) * 3),
      normals: new Float32Array((POISSON_MAX_POINTS + 1) * 3),
    }),
  ).toThrow(/500,000/);
});
