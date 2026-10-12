import { describe, expect, it } from "vitest";
import { accessGuideBoundsContext } from "../src/field-bounds-context";
import native from "./fixtures/field-native-bounds-context.json";

describe("recovered geometry bounds context accessor", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches complete native lifecycle case $id",
    (entry) => {
      const contexts = [{}, {}, {}];
      const holder = { context: contexts[0] };
      const steps: { kind: string; context: number }[] = [];
      const result = accessGuideBoundsContext(
        holder,
        entry.update !== 0,
        (context) => {
          steps.push({ kind: "valid", context: contexts.indexOf(context) });
          if (entry.replaceDuringValid) holder.context = contexts[1];
          return entry.ready;
        },
        (context) => {
          steps.push({
            kind: "initialize",
            context: contexts.indexOf(context),
          });
          if (entry.replaceDuringInitialize) holder.context = contexts[2];
        },
      );
      expect(contexts.indexOf(result)).toBe(entry.result);
      expect(steps).toEqual(entry.steps);
    },
  );
});
