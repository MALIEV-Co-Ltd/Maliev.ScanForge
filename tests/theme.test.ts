import { afterEach, describe, expect, it, vi } from "vitest";
import { readTheme, resolveTheme, storeTheme } from "../src/theme";
afterEach(() => vi.unstubAllGlobals());
describe("appearance preferences", () => {
  it("persists explicit appearance and resolves system changes", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key),
      setItem: (key: string, value: string) => values.set(key, value),
    });
    let dark = true;
    vi.stubGlobal("window", { matchMedia: () => ({ matches: dark }) });
    expect(readTheme()).toBe("system");
    expect(resolveTheme("system")).toBe("dark");
    dark = false;
    expect(resolveTheme("system")).toBe("light");
    storeTheme("dark");
    expect(readTheme()).toBe("dark");
    expect(resolveTheme("dark")).toBe("dark");
    values.set("scanforge-theme", "unknown");
    expect(readTheme()).toBe("system");
  });
  it("works when browser storage is disabled", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readTheme()).toBe("system");
    expect(() => storeTheme("light")).not.toThrow();
  });
});
