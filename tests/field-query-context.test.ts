import { describe, expect, it } from "vitest";
import { accessGuideQueryContext } from "../src/field-query-context";
import native from "./fixtures/field-native-query-context.json";

describe("recovered lazy guide query context", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches original accessor lifecycle case $id",
    (entry) => {
      const owner = {};
      const contexts = Array.from({ length: 3 }, () => ({
        owner: null as object | null,
      }));
      const holder = { context: contexts[0] };
      const steps: { kind: string; context: number; owner: boolean }[] = [];
      const result = accessGuideQueryContext(
        holder,
        owner,
        entry.update !== 0,
        (context) => {
          steps.push({
            kind: "valid",
            context: contexts.indexOf(context),
            owner: context.owner !== null,
          });
          if (entry.replaceDuringValid) holder.context = contexts[1];
          return entry.ready;
        },
        (context) => {
          steps.push({
            kind: "initialize",
            context: contexts.indexOf(context),
            owner: context.owner === owner,
          });
          if (entry.replaceDuringInitialize) holder.context = contexts[2];
        },
      );
      expect(contexts.indexOf(result)).toBe(entry.result);
      expect(contexts.map((context) => context.owner === owner)).toEqual(
        entry.owners,
      );
      expect(steps).toEqual(entry.steps);
    },
  );
  it("rechecks validity on successive update calls", () => {
    const owner = {};
    const holder = { context: { owner: null as object | null } };
    let initialized = 0;
    let ready = false;
    const update = () =>
      accessGuideQueryContext(
        holder,
        owner,
        true,
        () => ready,
        () => {
          initialized++;
          ready = true;
        },
      );
    expect(update()).toBe(holder.context);
    expect(update()).toBe(holder.context);
    expect(initialized).toBe(1);
    ready = false;
    update();
    expect(initialized).toBe(2);
  });
});
