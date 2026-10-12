import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Ribbon } from "../src/ui/Ribbon";
import { RIBBON_TABS, ribbonToolAvailability } from "../src/ui/ribbon-model";
import { ribbonVerification } from "../src/ui/ribbon-verification";

const ready = {
  disabled: false,
  hasSelection: true,
  canUndo: true,
  canRedo: true,
};
describe("ribbon verification gate", () => {
  it("blocks every unverified and planned command even with a supplied callback", () => {
    for (const tab of RIBBON_TABS)
      for (const group of tab.groups)
        for (const tool of group.tools) {
          const result = ribbonToolAvailability(tool, ready, {
            [tool.action ?? tool.id]: vi.fn(),
          });
          const verification = ribbonVerification(tool.id, !!tool.action);
          expect(result.available, tool.id).toBe(
            verification.status === "verified",
          );
          expect(verification.evidence).not.toBe("");
        }
  });
  it("never promotes an unknown command just because it has an implementation", () => {
    expect(ribbonVerification("newExperimentalTool", true).status).toBe(
      "unverified",
    );
    expect(ribbonVerification("newExperimentalTool", false).status).toBe(
      "planned",
    );
  });
  it("covers additional screenshot commands in their matching tabs", () => {
    const expected: Record<string, string[]> = {
      main: [
        "prepareScan",
        "deselectAll",
        "extractPrimitives",
        "constructTools",
        "alignTools",
        "sketch2d",
        "multipleSections",
        "surfacingTools",
        "autoFreeform",
        "moveFace",
        "trim",
        "combine",
        "cut",
        "intersect",
        "patternTools",
        "edgeTools",
      ],
      construct: ["plane2dSketch"],
      surfacing: ["surface2dSketch"],
      settings: ["millimetres", "inches", "metres", "language", "options"],
      help: [
        "videoTutorials",
        "helpPdf",
        "examples",
        "checkUpdates",
        "systemLog",
        "resetLayout",
        "changeLog",
        "credits",
        "about",
      ],
    };
    for (const [tabId, commands] of Object.entries(expected)) {
      const ids = RIBBON_TABS.find((tab) => tab.id === tabId)!.groups.flatMap(
        (group) => group.tools.map((tool) => tool.id),
      );
      for (const id of commands) expect(ids, `${tabId}:${id}`).toContain(id);
    }
  });
  it("renders real disabled buttons and visible status labels on every tab", () => {
    for (const tab of RIBBON_TABS) {
      const commands = tab.groups.flatMap((group) => group.tools);
      const actions = Object.fromEntries(
        commands.map((tool) => [tool.action ?? tool.id, vi.fn()]),
      );
      const markup = renderToStaticMarkup(
        <Ribbon
          {...ready}
          activeTab={tab.id}
          onTabChange={() => {}}
          actions={actions}
        />,
      );
      expect(markup).toContain("In progress and planned commands disabled");
      for (const tool of commands) {
        const button = markup.match(
          new RegExp(`<button[^>]*data-command="${tool.id}"[^>]*>`),
        )?.[0];
        expect(button, tool.id).toBeDefined();
        const status = ribbonVerification(tool.id, !!tool.action).status;
        expect(button).toContain(`data-verification="${status}"`);
        expect(button?.includes('disabled=""'), tool.id).toBe(
          status !== "verified",
        );
      }
    }
  });
});
