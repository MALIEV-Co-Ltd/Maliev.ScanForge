import type { WorkspaceHost } from "./api";
export function interactiveHostAdapter(
  current: () => WorkspaceHost,
  flush: (write: () => void) => void,
) {
  return {
    get publishInteractive(): WorkspaceHost["publishInteractive"] {
      if (!current().publishInteractive) return undefined;
      return (state) => {
        const host = current();
        const publish = () => {
          if (!host.publishInteractive)
            throw new Error("Interactive display is unavailable.");
          host.publishInteractive(state);
        };
        if (!!state !== !!host.inspectInteractive?.()) flush(publish);
        else publish();
      };
    },
    inspectInteractive: () => current().inspectInteractive?.() ?? null,
    get interactiveDragInput(): WorkspaceHost["interactiveDragInput"] {
      if (!current().interactiveDragInput) return undefined;
      return (input) => {
        const host = current();
        if (!host.interactiveDragInput)
          throw new Error("Interactive pointer adapter is unavailable.");
        return host.interactiveDragInput(input);
      };
    },
    get interactiveViewFrame(): WorkspaceHost["interactiveViewFrame"] {
      if (!current().interactiveViewFrame) return undefined;
      return () => {
        const host = current();
        if (!host.interactiveViewFrame)
          throw new Error("Interactive camera is unavailable.");
        return host.interactiveViewFrame();
      };
    },
    get finishInteractiveCurrentView(): WorkspaceHost["finishInteractiveCurrentView"] {
      if (!current().finishInteractiveCurrentView) return undefined;
      return () => current().finishInteractiveCurrentView?.();
    },
  };
}
