import type { Handler, WorkspaceHost } from "./api";
import type { Entity } from "../types";

export interface ViewportCommand {
  action:
    | "fit"
    | "rotate"
    | "projection"
    | "camera"
    | "sketchNormal"
    | "navigation"
    | "zoomWindow";
  orbitMode?: "free" | "constrained";
  zoomWindowActive?: boolean;
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
  entityId?: string;
  selection?: boolean;
  direction?: "left" | "right" | "up" | "down";
  degrees?: number;
  x?: number;
  y?: number;
  projection?: "orthographic" | "perspective";
  position?: [number, number, number];
  target?: [number, number, number];
  up?: [number, number, number];
  zoom?: number;
}
export interface InterfacePatch {
  ribbonTab?: string;
  workspace?: string;
  mode?: "inspect" | "measure" | "section" | "brush";
  toolPanelOpen?: boolean;
  datumAlignmentOpen?: boolean;
  globalAlignmentOpen?: boolean;
  settingsOpen?: boolean;
  settingsSection?: "appearance" | "spacemouse" | "import" | "agents";
  dismissError?: boolean;
}

/** Shared entry validation/defaults for the ribbon and agent interface command. */
export function coordinateAlignmentInterface(
  patch: InterfacePatch,
  selected?: Entity,
): InterfacePatch {
  if (!patch.datumAlignmentOpen) return patch;
  if (
    !selected ||
    selected.locked ||
    !selected.positions.length ||
    (!selected.kernelId &&
      (selected.parametric || !["mesh", "pointcloud"].includes(selected.kind)))
  )
    throw new Error("Select an unlocked scan or exact CAD object to align.");
  if (patch.workspace && patch.workspace !== "properties")
    throw new Error("Coordinate alignment uses the properties workspace.");
  if (patch.toolPanelOpen === false)
    throw new Error(
      "Coordinate alignment requires the tool panel to be visible.",
    );
  return {
    ...patch,
    workspace: "properties",
    toolPanelOpen: true,
    mode: "inspect",
  };
}

function unavailable(): never {
  throw new Error("Visual workflow is unavailable in this application host.");
}

/** Semantic observation/navigation; modeling continues through the existing domain tools. */
export function createWorkflowOperations(
  host: WorkspaceHost,
): Record<string, Handler> {
  return {
    landmark_preview: async (a, c) => {
      c.check();
      if (!host.previewLandmarks) return unavailable();
      return host.previewLandmarks({
        signal: c.signal,
        onProgress: c.progress,
        check: c.check,
        workerCount: a.workerCount ?? 2,
        parallel: a.parallel ?? true,
      });
    },
    landmark_accept: (_a, c) => {
      c.check();
      if (!host.acceptLandmarks) return unavailable();
      return host.acceptLandmarks();
    },
    landmark_get: () => host.inspectLandmarks?.() ?? unavailable(),
    landmark_edit: (a, c) => {
      c.check();
      if (!host.editLandmarks) return unavailable();
      return host.editLandmarks(
        a as Parameters<NonNullable<WorkspaceHost["editLandmarks"]>>[0],
      );
    },
    command_get: () => host.inspectCommands?.() ?? unavailable(),
    command_run: (a, c) => {
      c.check();
      if (!host.launchCommand) unavailable();
      return host.launchCommand(a.name);
    },
    command_repeat: (_a, c) => {
      c.check();
      if (!host.launchCommand) unavailable();
      return host.launchCommand();
    },
    application_inspect: (a) =>
      host.inspectApplication?.(a.maxControls ?? 150) ?? unavailable(),
    ui_set: (a, c) => {
      const { expectedRevision: _revision, requestId: _id, ...patch } = a;
      if (!Object.keys(patch).length)
        throw new Error("Supply at least one interface setting.");
      c.check();
      if (!host.setInterface) unavailable();
      const state = host.snapshot();
      host.setInterface(
        coordinateAlignmentInterface(
          patch,
          state.entities.find((entity) => entity.id === state.selectedId),
        ),
      );
      return host.inspectApplication?.(100) ?? unavailable();
    },
    viewport_get: () => host.inspectViewport?.() ?? unavailable(),
    spacemouse_get: () => host.inspectSpaceMouse?.() ?? unavailable(),
    spacemouse_control: (a, c) => {
      if (
        a.action === "preferences" &&
        (!a.preferences || !Object.keys(a.preferences).length)
      )
        throw new Error("Supply SpaceMouse preferences.");
      if (a.action !== "preferences" && a.preferences !== undefined)
        throw new Error("Preferences require the preferences action.");
      c.check();
      if (!host.controlSpaceMouse) return unavailable();
      return host.controlSpaceMouse(
        a as unknown as import("../spacemouse").SpaceMouseCommand,
        c.signal,
      );
    },
    viewport_control: (a, c) => {
      if (
        a.action === "navigation" &&
        a.orbitMode === undefined &&
        a.zoomWindowActive === undefined
      )
        throw new Error("Supply an orbit mode or window-tool state.");
      if (a.action === "zoomWindow" && (a.x0 === a.x1 || a.y0 === a.y1))
        throw new Error("Zoom window must have nonzero width and height.");
      if (a.action === "rotate" && (a.x === undefined) !== (a.y === undefined))
        throw new Error("Surface rotation requires both x and y.");
      if (a.action === "fit" && a.selection && !a.entityId)
        throw new Error("Selection framing requires an explicit object ID.");
      if (a.action === "fit" && a.entityId) {
        const state = host.snapshot();
        if (!state.entities.some((entity) => entity.id === a.entityId))
          throw new Error("Framing object not found.");
        if (
          a.selection &&
          (state.selectedId !== a.entityId || !state.selection?.some(Boolean))
        )
          throw new Error(
            "The requested object has no active triangle selection.",
          );
      }
      c.check();
      if (!host.controlViewport) unavailable();
      host.controlViewport(a as ViewportCommand);
      return host.inspectViewport?.() ?? unavailable();
    },
    viewport_pick: (a) =>
      host.pickViewport?.(a.x, a.y, a.maxHits ?? 5) ?? unavailable(),
    screenshot_capture: async (a, c) => {
      if (!host.captureScreenshot) unavailable();
      const image = await host.captureScreenshot(a, c.signal);
      c.check();
      const bytes = Uint8Array.from(atob(image.data), (char) =>
        char.charCodeAt(0),
      );
      const artifact = c.artifact(
        bytes,
        `scanforge-${image.scope}.${image.mimeType === "image/png" ? "png" : "jpg"}`,
        image.mimeType,
      );
      return { image, artifact, viewport: host.inspectViewport?.() };
    },
    history_get: () => {
      const state = host.snapshot();
      const labels = [
        ...state.history.map((entry) => entry.label),
        ...state.future.map((entry) => entry.label),
      ];
      return {
        cursor: state.history.length,
        entries: [
          {
            index: 0,
            label: "Starting state",
            current: state.history.length === 0,
          },
          ...labels.map((label, index) => ({
            index: index + 1,
            label,
            current: index + 1 === state.history.length,
          })),
        ],
        note: "Indices address retained history only; use history_seek with a fresh revision.",
      };
    },
    project_update: (a, c) => {
      c.check();
      if (!host.renameProject) unavailable();
      host.renameProject(a.name);
      return { name: host.snapshot().name };
    },
  };
}
