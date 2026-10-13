import { describe, expect, it, vi } from "vitest";

// An incomplete artwork batch must not prevent application modules from loading.
describe("Help artwork availability", () => {
  it("loads safely when no Help illustrations have been added", async () => {
    vi.resetModules();
    const { RIBBON_HELP_ICONS } = await import("../src/ui/RibbonHelpIcons");
    for (const [command, image] of Object.entries(RIBBON_HELP_ICONS)) {
      expect(command).not.toContain("/");
      expect(image).toMatch(/\.png(?:\?|$)/);
    }
  });
});
