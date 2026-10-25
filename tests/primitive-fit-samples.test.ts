import { expect, it, vi } from "vitest";
import { primitiveFitSamples } from "../src/primitive-fit-samples";
import { createOperations } from "../src/automation/operations";
import { fitPlane } from "../src/geometry";
import type { Entity } from "../src/types";
import type {
  WorkspaceHost,
  WorkspaceSnapshot,
  CommandContext,
} from "../src/automation/api";

function setup(
  kind: "mesh" | "pointcloud",
  positions: number[] | Float32Array,
  selection: Uint8Array,
) {
  const source: Entity = {
    id: "source",
    name: "scan",
    kind,
    positions,
    color: "#abcdef",
    visible: true,
    opacity: 1,
    meshSelection: { hidden: [0], saved: [] },
  };
  const state = {
    entities: [source],
    selectedId: source.id,
    selection,
  } as unknown as WorkspaceSnapshot;
  const operations = createOperations({
    snapshot: () => state,
  } as unknown as WorkspaceHost);
  const context = { check: vi.fn() } as unknown as CommandContext;
  return {
    state,
    source,
    fit: (
      selectionOnly?: boolean,
      region?: { center: [number, number, number]; radius: number },
    ) =>
      operations.analysis_fit(
        {
          entityId: source.id,
          kind: "plane",
          ...(selectionOnly === undefined ? {} : { selectionOnly }),
          ...(region ? { region } : {}),
        },
        context,
      ),
  };
}

it("fixes GUI sparse point IDs 0,3,6 and matches unchanged selected Float32 MCP input", async () => {
  const positions = new Float32Array(12 * 3),
    selection = new Uint8Array(12);
  for (let id = 0; id < 12; id++) positions.set([id, id * id, 50 + id], id * 3);
  positions.set([0, 0, 0], 0);
  positions.set([1, 0, 0], 9);
  positions.set([0, 1, 0], 18);
  for (const id of [0, 3, 6]) selection[id] = 1;
  const { source, fit } = setup("pointcloud", positions, selection);
  const before = positions.slice(),
    maskBefore = selection.slice();
  const gui = primitiveFitSamples(source, selection);
  expect(gui).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  expect(await fit(true)).toEqual({
    fit: fitPlane(gui),
    samples: 3,
    totalVertices: 3,
  });
  expect(positions).toEqual(before);
  expect(selection).toEqual(maskBefore);
});

it("preserves existing mask membership, hidden metadata, facet order and local filter", () => {
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 4, 0, 0, 5, 0, 0, 4, 1, 0,
  ]);
  const mesh = setup("mesh", positions, new Uint8Array([1, 0])).source;
  // Hidden metadata does not independently rewrite the primitive-fit mask.
  expect(primitiveFitSamples(mesh, new Uint8Array([1, 0]))).toEqual(
    Array.from(positions.slice(0, 9)),
  );
  expect(primitiveFitSamples(mesh, new Uint8Array([0, 1]))).toEqual(
    Array.from(positions.slice(9)),
  );
  const cloud = setup("pointcloud", positions, new Uint8Array(6)).source;
  expect(primitiveFitSamples(cloud, new Uint8Array(6))).toEqual(
    Array.from(positions),
  );
  expect(
    primitiveFitSamples(cloud, new Uint8Array([1, 0, 1, 0, 1, 0]), {
      center: [0, 0, 0],
      radius: 1,
    }),
  ).toEqual([0, 0, 0, 0, 1, 0]);
});

it.each(["mesh", "pointcloud"] as const)(
  "preserves the same selected %s Float64 samples in GUI and MCP",
  async (kind) => {
    const xyz = [
      0.000000001, 0, 0, 1.00000001, 0, 0, 0, 1.00000001, 0.100000001,
    ];
    const positions =
      kind === "mesh" ? [...xyz, 5, 5, 5, 6, 5, 5, 5, 6, 5] : [...xyz, 5, 5, 5];
    const selection =
      kind === "mesh" ? new Uint8Array([1, 0]) : new Uint8Array([1, 1, 1, 0]);
    const { source, fit } = setup(kind, positions, selection);
    const gui = primitiveFitSamples(source, selection),
      narrowed = Array.from(new Float32Array(xyz));
    expect(gui).toEqual(xyz);
    expect(gui).not.toEqual(narrowed);
    expect(await fit(true)).toEqual({
      fit: fitPlane(gui),
      samples: 3,
      totalVertices: 3,
    });
    // Omitted selection follows the GUI's active mask; false explicitly fits the whole source.
    const whole = {
      fit: fitPlane(positions),
      samples: positions.length / 3,
      totalVertices: positions.length / 3,
    };
    expect(await fit()).toEqual({
      fit: fitPlane(gui),
      samples: 3,
      totalVertices: 3,
    });
    expect(await fit(false)).toEqual(whole);
  },
);

it("does not use another object's selection when selectionOnly is omitted", async () => {
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5];
  const { state, fit } = setup(
    "pointcloud",
    positions,
    new Uint8Array([1, 1, 1, 0]),
  );
  state.selectedId = null;
  expect(await fit()).toEqual({
    fit: fitPlane(positions),
    samples: 4,
    totalVertices: 4,
  });
});

it("exposes the same local fitting region through the shared MCP operation", async () => {
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 100, 100, 100];
  const region = { center: [0, 0, 0] as [number, number, number], radius: 2 };
  const { source, fit } = setup("pointcloud", positions, new Uint8Array(4));
  const gui = primitiveFitSamples(source, undefined, region);
  expect(await fit(false, region)).toEqual({
    fit: fitPlane(gui),
    samples: 3,
    totalVertices: 3,
  });
  expect(() => fit(false, { ...region, radius: 0 })).toThrow(/radius/i);
});

it("retains existing GUI empty-mask fallback and MCP explicit-empty rejection", () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const { source, fit } = setup("pointcloud", positions, new Uint8Array(3));
  expect(primitiveFitSamples(source, new Uint8Array(3))).toEqual(
    Array.from(positions),
  );
  expect(() => fit(true)).toThrow(/empty/);
});

it("retains the original eligible-record stride and bounded 20,000 sample policy", () => {
  const positions = new Float32Array(40_002 * 3),
    selection = new Uint8Array(40_002);
  for (let id = 0; id < selection.length; id++) {
    positions.set([id, 0, 0], id * 3);
    if (id % 2 === 0) selection[id] = 1;
  }
  const result = primitiveFitSamples(
    { kind: "pointcloud", positions },
    selection,
  );
  expect(result.length / 3).toBe(10_001);
  expect(result.slice(0, 6)).toEqual([0, 0, 0, 4, 0, 0]);
  expect(result.slice(-3)).toEqual([40_000, 0, 0]);
});
