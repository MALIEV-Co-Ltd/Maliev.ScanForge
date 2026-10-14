import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { ApplicationApi, type WorkspaceHost } from "./api";
import { createOperations } from "./operations";
import { createAuthoringOperations } from "./authoring-operations";
import { createWorkflowOperations } from "./workflow-operations";

/** Stable API lifetime; handlers always see the current React workspace, never a captured initial render. */
export function useWorkspaceApi(host: WorkspaceHost) {
  const current = useRef(host);
  current.current = host;
  const api = useRef<ApplicationApi | null>(null);
  if (!api.current) {
    const mutate = <T>(run: () => T): T => flushSync(run);
    const proxy: WorkspaceHost = {
      inspectLandmarks: () => current.current.inspectLandmarks?.(),
      editLandmarks: (edit) =>
        mutate(() => {
          if (!current.current.editLandmarks)
            throw new Error("Landmark editing unavailable");
          return current.current.editLandmarks(edit);
        }),
      inspectCommands: () => current.current.inspectCommands?.(),
      launchCommand: (name) =>
        mutate(() => {
          if (!current.current.launchCommand)
            throw new Error("Command launch unavailable");
          return current.current.launchCommand(name);
        }),
      snapshot: () => current.current.snapshot(),
      showDatumPreview: (entities) =>
        mutate(() => {
          if (!current.current.showDatumPreview)
            throw new Error("Coordinate preview unavailable");
          current.current.showDatumPreview(entities);
        }),
      discardPreview: (target) =>
        mutate(() => {
          if (!current.current.discardPreview)
            throw new Error("GUI preview cancellation unavailable");
          current.current.discardPreview(target);
        }),
      inspectApplication: (limit) =>
        current.current.inspectApplication?.(limit),
      setInterface: (patch) =>
        mutate(() => {
          if (!current.current.setInterface)
            throw new Error("Interface control unavailable");
          current.current.setInterface(patch);
        }),
      inspectViewport: () => current.current.inspectViewport?.(),
      controlViewport: (command) => {
        if (!current.current.controlViewport)
          throw new Error("Viewport control unavailable");
        current.current.controlViewport(command);
      },
      pickViewport: (x, y, limit) =>
        current.current.pickViewport?.(x, y, limit),
      captureScreenshot: (options, signal) => {
        if (!current.current.captureScreenshot)
          throw new Error("Screenshot capture unavailable");
        return current.current.captureScreenshot(options, signal);
      },
      renameProject: (name) =>
        mutate(() => {
          if (!current.current.renameProject)
            throw new Error("Project rename unavailable");
          current.current.renameProject(name);
        }),
      deleteBackup: async (id) => {
        if (!current.current.deleteBackup)
          throw new Error("Backup deletion unavailable");
        await current.current.deleteBackup(id);
      },
      cad: () => current.current.cad(),
      commit: (entities, label) =>
        mutate(() => current.current.commit(entities, label)),
      replace: (project, cad, session) =>
        mutate(() => current.current.replace(project, cad, session)),
      select: (id, modifiers) =>
        mutate(() => current.current.select(id, modifiers)),
      present: (signal) =>
        current.current.present?.(signal) ?? Promise.resolve(),
      setSelection: (entityId, mask) =>
        mutate(() => current.current.setSelection(entityId, mask)),
      setSketch: (sketch) => mutate(() => current.current.setSketch(sketch)),
      setAuthoring: (authoring) =>
        mutate(() => {
          if (!current.current.setAuthoring)
            throw new Error("Authoring management unavailable");
          current.current.setAuthoring(authoring);
        }),
      undo: () => mutate(() => current.current.undo()),
      redo: () => mutate(() => current.current.redo()),
      view: (view) => current.current.view(view),
      settings: (patch) => mutate(() => current.current.settings(patch)),
      busy: () => current.current.busy(),
      activity: (busy, message, selectionMode) =>
        mutate(() => current.current.activity(busy, message, selectionMode)),
    };
    api.current = new ApplicationApi(proxy, {
      ...createOperations(proxy),
      ...createAuthoringOperations(proxy),
      ...createWorkflowOperations(proxy),
    });
  }
  useEffect(() => () => api.current?.dispose(), []);
  return api.current;
}
