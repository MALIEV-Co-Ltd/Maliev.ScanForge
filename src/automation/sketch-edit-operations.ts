import {
  applySketchEditIntent,
  type SketchEditIntent,
} from "../sketch-edit-intent";
import type { Handler, WorkspaceHost } from "./api";

/** Semantic edits use the same draft publisher and scoped history as canvas edits. */
export function createSketchEditOperations(
  host: WorkspaceHost,
): Record<string, Handler> {
  return {
    sketch_edit: (args, context) => {
      const state = host.snapshot(),
        sketch = state.sketchDraft ?? state.authoring.sketch;
      if (!sketch) throw Error("No active sketch.");
      if (!context.mutate)
        throw Error("Sketch editing requires the shared mutation context.");
      const {
        expectedRevision: _revision,
        requestId: _requestId,
        ...intent
      } = args;
      const result = applySketchEditIntent(sketch, intent as SketchEditIntent, {
        check: context.check,
        signal: context.signal,
      });
      context.check();
      if (result.changed) context.mutate(() => host.setSketch(result.sketch));
      const { sketch: _sketch, ...receipt } = result;
      return { ...receipt, units: "mm", coordinateSystem: "sketch-local-UV" };
    },
  };
}
