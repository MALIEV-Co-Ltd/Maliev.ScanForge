import type { InteractiveAlignmentState } from "./interactive-alignment-session";

/** Publish pose frames without rerendering the workbench or rebuilding scan buffers. */
export class InteractiveAlignmentStore {
  private state: InteractiveAlignmentState | null = null;
  private readonly listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  publish = (state: InteractiveAlignmentState | null) => {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.listeners) listener();
  };
}
