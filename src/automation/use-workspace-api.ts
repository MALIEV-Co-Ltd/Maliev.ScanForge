import { interactiveHostAdapter } from "./interactive-host-adapter";
import { useEffect, useRef } from "react";
import { createScanSelectionOperations } from "./scan-selection-operations";
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
      showInspection: (display) =>
        mutate(() => {
          if (display && !current.current.showInspection)
            throw new Error("Inspection display is unavailable.");
          current.current.showInspection?.(display);
        }),
      showMeasurement: (measurement) =>
        mutate(() => {
          if (measurement && !current.current.showMeasurement)
            throw new Error("Measurement display is unavailable.");
          current.current.showMeasurement?.(measurement);
        }),
      showSection: (section) =>
        mutate(() => {
          if (section && !current.current.showSection)
            throw new Error("Section display is unavailable.");
          current.current.showSection?.(section);
        }),
      inspectScanSelection: () => current.current.inspectScanSelection?.(),
      controlScanSelection: (command) =>
        mutate(() => {
          if (!current.current.controlScanSelection)
            throw new Error("Scan selection editor unavailable.");
          current.current.controlScanSelection(command);
        }),
      selectScanRegion: (entityId, region, through, signal) => {
        if (!current.current.selectScanRegion)
          throw new Error("Scan selection viewport unavailable.");
        return current.current.selectScanRegion(
          entityId,
          region,
          through,
          signal,
        );
      },
      previewLandmarks: (options) => {
        if (!current.current.previewLandmarks)
          throw new Error("Landmark preview unavailable");
        return current.current.previewLandmarks(options);
      },
      acceptLandmarks: () =>
        mutate(() => {
          if (!current.current.acceptLandmarks)
            throw new Error("Landmark acceptance unavailable");
          return current.current.acceptLandmarks();
        }),
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
      showScanPreview: (preview) =>
        mutate(() => current.current.showScanPreview?.(preview)),
      clearScanPreview: (previewId) =>
        mutate(() => current.current.clearScanPreview?.(previewId)),
      showReferenceConstructionPreview: (owner, candidate) => {
        if (!current.current.showReferenceConstructionPreview)
          throw new Error("Reference construction preview unavailable");
        current.current.showReferenceConstructionPreview(owner, candidate);
      },
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
      inspectViewport: (view) => current.current.inspectViewport?.(view),
      referenceCoordinateView: (entityId, view) => {
        if (!current.current.referenceCoordinateView)
          throw new Error("Reference coordinate camera capture unavailable.");
        return current.current.referenceCoordinateView(entityId, view);
      },
      inspectSpaceMouse: () => current.current.inspectSpaceMouse?.(),
      controlSpaceMouse: (command, signal) => {
        if (!current.current.controlSpaceMouse)
          throw new Error("SpaceMouse control unavailable");
        return current.current.controlSpaceMouse(command, signal);
      },
      controlViewport: (command) => {
        if (!current.current.controlViewport)
          throw new Error("Viewport control unavailable");
        current.current.controlViewport(command);
      },
      pickViewport: (x, y, limit, view) =>
        current.current.pickViewport?.(x, y, limit, view),
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
      commit: (entities, label, policy) =>
        mutate(() =>
          policy === undefined
            ? current.current.commit(entities, label)
            : current.current.commit(entities, label, policy),
        ),
      replace: (project, cad, session) =>
        mutate(() => current.current.replace(project, cad, session)),
      select: (id, modifiers) =>
        mutate(() => current.current.select(id, modifiers)),
      present: (signal) =>
        current.current.present?.(signal) ?? Promise.resolve(),
      setSelection: (entityId, mask) =>
        mutate(() => current.current.setSelection(entityId, mask)),
      setSketch: (sketch) => mutate(() => current.current.setSketch(sketch)),
      stepSketchHistory: (repeat) =>
        mutate(() => {
          if (!current.current.stepSketchHistory)
            throw new Error("Sketch history is unavailable.");
          return current.current.stepSketchHistory(repeat);
        }),
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
    Object.defineProperties(
      proxy,
      Object.getOwnPropertyDescriptors(
        interactiveHostAdapter(() => current.current, mutate),
      ),
    );
    api.current = new ApplicationApi(proxy, {
      ...createOperations(proxy),
      ...createAuthoringOperations(proxy),
      ...createWorkflowOperations(proxy),
      ...createScanSelectionOperations(proxy),
    });
  }
  useEffect(() => api.current!.retainOwner(), []);
  const publication = host.snapshot();
  useEffect(() => {
    api.current!.observeModelPublication();
  }, [
    publication.entities,
    publication.history,
    publication.future,
    publication.projectId,
  ]);
  return api.current;
}
