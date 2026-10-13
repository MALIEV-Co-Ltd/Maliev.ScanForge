import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { ApplicationApi, type WorkspaceHost } from "./api";
import { createOperations } from "./operations";
import { createAuthoringOperations } from "./authoring-operations";

/** Stable API lifetime; handlers always see the current React workspace, never a captured initial render. */
export function useWorkspaceApi(host: WorkspaceHost) {
  const current = useRef(host);
  current.current = host;
  const api = useRef<ApplicationApi | null>(null);
  if (!api.current) {
    const mutate = (run: () => void) => flushSync(run);
    const proxy: WorkspaceHost = {
      snapshot: () => current.current.snapshot(),
      cad: () => current.current.cad(),
      commit: (entities, label) =>
        mutate(() => current.current.commit(entities, label)),
      replace: (project, cad, session) =>
        mutate(() => current.current.replace(project, cad, session)),
      select: (id) => mutate(() => current.current.select(id)),
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
      activity: (busy, message) =>
        mutate(() => current.current.activity(busy, message)),
    };
    api.current = new ApplicationApi(proxy, {
      ...createOperations(proxy),
      ...createAuthoringOperations(proxy),
    });
  }
  useEffect(() => () => api.current?.dispose(), []);
  return api.current;
}
