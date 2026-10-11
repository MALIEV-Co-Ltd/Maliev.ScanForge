export type Theme = "light" | "dark" | "system";
const key = "scanforge-theme";
export function readTheme(): Theme {
  try {
    const value = localStorage.getItem(key);
    return value === "light" || value === "dark" || value === "system"
      ? value
      : "system";
  } catch {
    return "system";
  }
}
export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(key, theme);
  } catch {
    /* Storage can be disabled. */
  }
}
export function resolveTheme(theme: Theme): "light" | "dark" {
  return theme === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : theme;
}
