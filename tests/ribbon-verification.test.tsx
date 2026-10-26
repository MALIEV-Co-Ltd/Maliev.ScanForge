import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Ribbon } from "../src/ui/Ribbon";
import {
  RIBBON_TABS,
  getRibbonToolMetadata,
  ribbonToolAvailability,
} from "../src/ui/ribbon-model";
import { ribbonVerification } from "../src/ui/ribbon-verification";

const ready = {
  landmarkSourceId: "scan",
  disabled: false,
  hasSelection: true,
  hasSketchSurfaceSource: true,
  canUndo: true,
  canRedo: true,
};
describe("ribbon verification gate", () => {
  it("exposes verified coordinate and fine alignment while retaining the separate coordinate-system gate", () => {
    const fine = getRibbonToolMetadata("fineAlign")!;
    expect(
      ribbonToolAvailability(fine, ready, { fineAlign: vi.fn() }).available,
    ).toBe(true);
    expect(
      ribbonToolAvailability(
        fine,
        { ...ready, disabled: true },
        { fineAlign: vi.fn() },
      ).available,
    ).toBe(false);
    expect(ribbonVerification("align", true).status).toBe("verified");
    expect(ribbonVerification("alignCoordinates", false).status).toBe(
      "planned",
    );
  });
  it("blocks every unverified and planned command even with a supplied callback", () => {
    for (const tab of RIBBON_TABS)
      for (const group of tab.groups)
        for (const tool of group.tools.flatMap((tool) => [
          tool,
          ...(tool.options ?? []),
        ])) {
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
  it("renders the verified point-pair entry disabled without a resolved source", () => {
    for (const source of [null, undefined]) {
      const markup = renderToStaticMarkup(
        <Ribbon
          {...ready}
          landmarkSourceId={source}
          activeTab="scan"
          onTabChange={() => {}}
          actions={{ alignNPoints: vi.fn() }}
        />,
      );
      const button = markup.match(
        /<button[^>]*data-command="alignNPoints"[^>]*>/,
      )?.[0];
      expect(button).toBeDefined();
      expect(button).toContain('data-verification="verified"');
      expect(button).toContain('disabled=""');
      expect(button).toContain("Choose an unlocked visible scan");
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
      scan: ["editScan", "repairMesh", "segmentMesh", "align"],
      cad: [
        "sketch2d",
        "multipleSections",
        "moveFace",
        "trim",
        "combine",
        "cut",
        "intersect",
      ],
      freeform: ["autoFreeform"],
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
  it("renders disabled buttons and status icons on every tab without visible status labels", () => {
    for (const tab of RIBBON_TABS) {
      const commands = tab.groups.flatMap((group) =>
        group.tools.flatMap((tool) => [tool, ...(tool.options ?? [])]),
      );
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
      expect(markup).not.toContain("ribbon-verification-legend");
      expect(markup).not.toMatch(/>(In progress|Planned)</);
      expect(markup).not.toContain("ribbon-verification-badge");
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
        const content = markup.match(
          new RegExp(
            `<button[^>]*data-command="${tool.id}"[^>]*>([\\s\\S]*?)</button>`,
          ),
        )?.[1];
        if (status === "verified") {
          expect(content, tool.id).not.toContain("ribbon-status-icon");
        } else {
          expect(content, tool.id).toContain(`data-status-icon="${status}"`);
          expect(content, tool.id).toContain(
            status === "planned" ? "ui-Milestone.png" : "ui-Wrench.png",
          );
          expect(button, tool.id).toContain("aria-description=");
        }
      }
    }
  });
  it("keeps option menus usable while independently gating their commands", () => {
    const markup = renderToStaticMarkup(
      <Ribbon
        {...ready}
        hasSelection={false}
        activeTab="main"
        onTabChange={() => {}}
        actions={{
          repairMesh: vi.fn(),
          cleanup: vi.fn(),
          flipNormals: vi.fn(),
          exportStep: vi.fn(),
          exportStl: vi.fn(),
        }}
        projectRecovery={<button>Backup and recovery</button>}
      />,
    );
    expect(markup).toContain('aria-label="Repair options"');
    expect(markup).toContain('popover="auto"');
    expect(markup).toMatch(/popovertarget=/i);
    expect(markup).toContain("Backup and recovery");
    for (const id of [
      "repairMesh",
      "cleanup",
      "flipNormals",
      "sketchFromSection",
      "sectionView",
    ])
      expect(
        markup.match(new RegExp(`<button[^>]*data-command="${id}"[^>]*>`))?.[0],
        id,
      ).toContain('disabled=""');
    for (const id of ["exportStep", "exportStl"])
      expect(
        markup.match(new RegExp(`<button[^>]*data-command="${id}"[^>]*>`))?.[0],
        id,
      ).not.toContain('disabled=""');
  });
});

it("renders From 2D sketch using the sketch source gate with no selected object", () => {
  for (const hasSketchSurfaceSource of [false, true]) {
    const markup = renderToStaticMarkup(
      <Ribbon
        {...ready}
        hasSelection={false}
        hasSketchSurfaceSource={hasSketchSurfaceSource}
        activeTab="surfacing"
        onTabChange={() => {}}
        actions={{ surface2dSketch: vi.fn() }}
      />,
    );
    const button = markup.match(
      /<button[^>]*data-command="surface2dSketch"[^>]*>/,
    )?.[0];
    expect(button).toContain('data-verification="verified"');
    expect(button?.includes('disabled=""')).toBe(!hasSketchSurfaceSource);
  }
});

it("renders the reachable section command with its guarded callback", () => {
  for (const activeTab of ["main", "sketch"]) {
    const markup = renderToStaticMarkup(
      <Ribbon
        {...ready}
        activeTab={activeTab}
        onTabChange={() => {}}
        actions={{ sketchFromSection: vi.fn() }}
      />,
    );
    const button = markup.match(
      /<button[^>]*data-command="sketchFromSection"[^>]*>/,
    )?.[0];
    expect(button).toBeDefined();
    expect(button).toContain('data-verification="verified"');
    expect(button).not.toContain('disabled=""');
  }
});
