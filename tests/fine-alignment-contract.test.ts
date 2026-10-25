import { expect, it } from "vitest";
import catalog from "../src/automation/catalog.json";
import { validateInput } from "../src/automation/api";

it("discovers configurable fine accuracy while retaining old MCP requests", () => {
  const tool = catalog.find((t) => t.name === "mesh_process")!;
  const args = {
    entityId: "moving",
    targetId: "fixed",
    expectedRevision: 0,
    requestId: "fine",
    operation: {
      kind: "icp",
      sampleSize: 20000,
      targetSampleSize: 20000,
      maxDistance: 10,
      maxIterations: 200,
      trimFraction: 0.85,
      tolerance: 1e-5,
    },
  };
  expect(() => validateInput(tool.inputSchema, args)).not.toThrow();
  for (const targetRms of [0.02, 0.5])
    expect(() =>
      validateInput(tool.inputSchema, {
        ...args,
        operation: { ...args.operation, targetRms },
      }),
    ).not.toThrow();
  for (const targetRms of [0, -1, "0.5"])
    expect(() =>
      validateInput(tool.inputSchema, {
        ...args,
        operation: { ...args.operation, targetRms },
      }),
    ).toThrow();
  expect(tool.description).toContain("terminationReason");
  expect(tool.description).toContain("inlierRms");
  const { trimFraction: legacy, ...operation } = args.operation;
  for (const overlapPercent of [50, 60, 80, 100])
    expect(() =>
      validateInput(tool.inputSchema, {
        ...args,
        operation: { ...operation, overlapPercent, sampleSize: 37 },
      }),
    ).not.toThrow();
  for (const bad of [
    { overlapPercent: 0 },
    { overlapPercent: 101 },
    { sampleSize: 2 },
    { sampleSize: 3.5 },
    { sampleSize: 100001 },
  ])
    expect(() =>
      validateInput(tool.inputSchema, {
        ...args,
        operation: { ...operation, ...bad },
      }),
    ).toThrow();
  expect(tool.description).toContain("targetRmsBasis:overlap");
});
