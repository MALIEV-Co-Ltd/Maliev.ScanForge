import { expect, it, vi } from "vitest";
import * as THREE from "three";
import catalog from "../src/automation/catalog.json";
import { validateInput } from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { WorkspaceHost, CommandContext } from "../src/automation/api";
import { Viewport } from "../src/viewport";
import { createViewportGrid } from "../src/viewport-grid";

it("exposes automatic/manual spacing through the existing MCP settings operation", () => {
  const settings = vi.fn();
  const ops = createOperations({ settings } as unknown as WorkspaceHost);
  const schema = catalog.find(
    (entry) => entry.name === "settings_set",
  )!.inputSchema;
  const patch = { automaticGrid: true, gridSpacing: 2.5, snapGrid: true };
  validateInput(schema, { patch, expectedRevision: 0, requestId: "grid" });
  ops.settings_set({ patch }, { check: vi.fn() } as unknown as CommandContext);
  expect(settings).toHaveBeenCalledWith(patch);
  expect(() =>
    validateInput(schema, {
      patch: { automaticGrid: "yes" },
      expectedRevision: 0,
      requestId: "bad",
    }),
  ).toThrow();
});

it("keeps snap spacing independent and reuses grid geometry during unchanged updates", () => {
  const view = Object.create(Viewport.prototype) as any;
  const grid = createViewportGrid(10);
  Object.assign(view, {
    grid,
    gridSpacing: 10,
    bounds: new THREE.Box3(
      new THREE.Vector3(-300, -100, -20),
      new THREE.Vector3(300, 100, 20),
    ),
    setTheme: vi.fn(),
    invalidate: vi.fn(),
    theme: "dark",
    camera: new THREE.OrthographicCamera(-100, 100, 100, -100),
    controls: { target: new THREE.Vector3() },
    container: { clientWidth: 500, clientHeight: 500 },
  });
  try {
    view.setGridOptions(true, 2.5, true, true);
    expect(grid.userData.spacing).toBe(50);
    expect(view.gridSpacing).toBe(2.5);
    expect(view.snapGrid).toBe(true);
    const geometry = grid.geometry;
    view.setGridOptions(true, 2.5, true, true);
    expect(grid.geometry).toBe(geometry);
    view.setGridOptions(true, 25, true, false);
    expect(grid.userData.spacing).toBe(25);
    view.setGridOptions(true, 0.001, true, false);
    expect(view.getGridState().effectiveGridSpacing).toBeGreaterThan(0.001);
    expect(view.getGridState().effectiveGridSpacing).toBe(
      (grid.userData.halfExtent * 2) / grid.userData.divisions,
    );
  } finally {
    grid.geometry.dispose();
    (grid.material as THREE.Material).dispose();
  }
});
