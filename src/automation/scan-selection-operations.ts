import type { Handler, WorkspaceHost } from "./api";
import type { ScreenRegion } from "../screen-selection";
import type { ScanClipBounds } from "../scan-clip-box";
import { assertSampledGeometry } from "../reference-entity";

export interface ScanSelectionControl {
  entityId: string;
  action:
    | "configure"
    | "hide"
    | "isolate"
    | "reveal"
    | "revealSelected"
    | "undo"
    | "redo";
  tool?: "wand" | "brush" | "freehand" | "line" | "rectangle" | "circle";
  through?: boolean;
  clip?: ScanClipBounds | null;
  angleDegrees?: number;
  brushRadiusPx?: number;
  allConnected?: boolean;
}

export function validateScanSelectionControl(command: ScanSelectionControl) {
  if (
    command.action !== "configure" &&
    (command.tool !== undefined ||
      command.through !== undefined ||
      command.clip !== undefined ||
      command.angleDegrees !== undefined ||
      command.brushRadiusPx !== undefined ||
      command.allConnected !== undefined)
  )
    throw new Error("Selection options require configure.");
  if (
    command.angleDegrees !== undefined &&
    (!Number.isFinite(command.angleDegrees) ||
      command.angleDegrees < 0 ||
      command.angleDegrees > 90)
  )
    throw new Error("Selection angle must be between 0 and 90 degrees.");
  if (
    command.brushRadiusPx !== undefined &&
    (!Number.isFinite(command.brushRadiusPx) ||
      command.brushRadiusPx < 2 ||
      command.brushRadiusPx > 500)
  )
    throw new Error("Brush radius must be between 2 and 500 CSS pixels.");
  if (command.clip)
    for (let axis = 0; axis < 3; axis++)
      if (
        !Number.isFinite(command.clip.min[axis]) ||
        !Number.isFinite(command.clip.max[axis]) ||
        command.clip.min[axis] > command.clip.max[axis]
      )
        throw new Error("Clipping limits must be finite and ordered.");
}

export function createScanSelectionOperations(
  host: WorkspaceHost,
): Record<string, Handler> {
  const target = (entityId: string) => {
    const state = host.snapshot();
    const entity = state.entities.find((e) => e.id === entityId);
    if (!entity || state.selectedId !== entityId)
      throw new Error("Select the target scan first.");
    assertSampledGeometry(entity);
    if (
      entity.locked ||
      entity.selectable === false ||
      !entity.visible ||
      entity.kernelId ||
      entity.parametric
    )
      throw new Error("Select an unlocked visible scan.");
    return entity;
  };
  return {
    scan_selection_get: () =>
      host.inspectScanSelection?.() ?? { available: false },
    scan_selection_control: (a, c) => {
      target(a.entityId);
      validateScanSelectionControl(a as ScanSelectionControl);
      if (!host.controlScanSelection)
        throw new Error("Scan selection editor unavailable.");
      c.check();
      host.controlScanSelection(a as ScanSelectionControl);
      return host.inspectScanSelection?.();
    },
    scan_select_region: async (a, c) => {
      const entity = target(a.entityId);
      if (!host.selectScanRegion)
        throw new Error("Scan selection viewport unavailable.");
      c.check();
      const selected = await host.selectScanRegion(
        entity.id,
        a.region as ScreenRegion,
        a.through ?? false,
        c.signal,
      );
      c.check();
      const state = host.snapshot();
      const count =
        entity.positions.length / (entity.kind === "pointcloud" ? 3 : 9);
      if (selected.length !== count)
        throw new Error("Selection geometry changed.");
      const prior =
        state.selection?.length === count
          ? state.selection
          : new Uint8Array(count);
      const hidden = new Set(entity.meshSelection?.hidden ?? []);
      const mask = Uint8Array.from(selected, (value, i) =>
        hidden.has(i)
          ? 0
          : a.operation === "subtract"
            ? prior[i] && !value
              ? 1
              : 0
            : a.operation === "add"
              ? prior[i] || value
                ? 1
                : 0
              : value,
      );
      const write = () => host.setSelection(entity.id, mask);
      if (c.mutate) c.mutate(write);
      else write();
      return {
        entityId: entity.id,
        elementKind: entity.kind === "pointcloud" ? "points" : "triangles",
        count: mask.reduce((sum, value) => sum + value, 0),
      };
    },
  };
}
