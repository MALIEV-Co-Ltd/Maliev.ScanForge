import { expect, it } from "vitest";

it("admits explicit defaults and refuses invalid work before a worker is allocated", async () => {
  const input = await import("../src/point-cloud-poisson-input").catch(
    () => undefined,
  );
  expect(input, "Poisson request admission must exist").toBeDefined();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const request = { kind: "pointCloudPoisson" as const, positions, normals };
  expect(input!.validatePointCloudPoissonInput(request)).toMatchObject({
    normalMode: "provided",
    normalNeighbors: 24,
    depth: 8,
    pointWeight: 2,
    samplesPerNode: 1.5,
    densityThreshold: 0,
  });
  for (const patch of [
    { positions: new Float32Array(500001 * 3) },
    { normals: undefined },
    { normals: [0, 0, 1] },
    { depth: 11 },
    { depth: 7.5 },
    { normalMode: "guess" },
    { normalMode: "estimate-viewpoint" },
    { normalNeighbors: 49 },
    { densityThreshold: -1 },
    { pointWeight: Infinity },
    { samplesPerNode: 0 },
  ])
    expect(() =>
      input!.validatePointCloudPoissonInput({ ...request, ...patch } as never),
    ).toThrow();
  expect(() =>
    input!.validatePointCloudPoissonInput({
      ...request,
      normals: undefined,
      normalMode: "estimate-outward",
    }),
  ).not.toThrow();
});
