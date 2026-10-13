/** Bounded accessibility-oriented inspection; no arbitrary DOM execution or credential values. */
export function inspectApplicationDom(root: HTMLElement, limit = 150) {
  const visible = (node: Element) => {
    if (node.closest('[hidden], [aria-hidden="true"], [data-agent-private]'))
      return false;
    const style = getComputedStyle(node);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      node.getClientRects().length > 0
    );
  };
  const label = (node: Element) => {
    const labelledBy = node.getAttribute("aria-labelledby");
    const linked = labelledBy
      ?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    const associated =
      node instanceof HTMLInputElement ||
      node instanceof HTMLSelectElement ||
      node instanceof HTMLTextAreaElement
        ? [...(node.labels ?? [])]
            .map((entry) => entry.textContent ?? "")
            .join(" ")
        : "";
    return (
      node.getAttribute("aria-label") ||
      linked ||
      associated ||
      node.getAttribute("title") ||
      node.textContent ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
  };
  const nodes = [
    ...root.querySelectorAll(
      'button, input, select, textarea, [role="button"], [role="tab"], [role="radio"], [role="checkbox"], [role="slider"]',
    ),
  ].filter(visible);
  return {
    dialogs: [...root.querySelectorAll('[role="dialog"], dialog')]
      .filter(visible)
      .map(label),
    statuses: [...root.querySelectorAll('[role="status"], [role="alert"]')]
      .filter(visible)
      .map(label),
    totalControls: nodes.length,
    truncated: nodes.length > limit,
    controls: nodes.slice(0, limit).map((node) => {
      const secret = node.matches(
        'input[type="password"], input[type="file"], [autocomplete*="password"], [aria-label*="token" i], [name*="token" i]',
      );
      const field =
        node instanceof HTMLInputElement ||
        node instanceof HTMLTextAreaElement ||
        node instanceof HTMLSelectElement;
      return {
        role: node.getAttribute("role") || node.tagName.toLowerCase(),
        label: label(node),
        disabled:
          node.matches(":disabled") ||
          node.getAttribute("aria-disabled") === "true",
        selected: node.getAttribute("aria-selected"),
        checked:
          node instanceof HTMLInputElement &&
          ["checkbox", "radio"].includes(node.type)
            ? node.checked
            : undefined,
        ...(!secret && field ? { value: node.value.slice(0, 512) } : {}),
      };
    }),
  };
}
