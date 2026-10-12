import "./canvas-pick-menu.css";

export interface CanvasPickChoice {
  id: string;
  label: string;
  choose: () => void;
  hover?: () => void;
}
/** One entry per intersected object; preserves nearest-to-farthest ray order. */
export function uniquePickChoices(
  choices: CanvasPickChoice[],
): CanvasPickChoice[] {
  const ids = new Set<string>();
  return choices.filter(
    (choice) => !ids.has(choice.id) && !!ids.add(choice.id),
  );
}
export class CanvasPickMenu {
  private timer?: ReturnType<typeof setTimeout>;
  private menu?: HTMLDivElement;
  private anchor?: [number, number];
  constructor(
    private host: HTMLElement,
    private opened: () => void,
    private closed: () => void,
  ) {
    document.addEventListener("pointerdown", this.outside);
    document.addEventListener("keydown", this.key);
  }
  begin(x: number, y: number, choices: () => CanvasPickChoice[]) {
    this.close();
    this.anchor = [x, y];
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const options = uniquePickChoices(choices());
      if (!options.length) return;
      const menu = document.createElement("div");
      menu.className = "canvas-pick-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "Select item beneath pointer");
      for (const option of options) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.textContent = option.label;
        button.onpointerenter = () => option.hover?.();
        button.onfocus = () => option.hover?.();
        button.onclick = () => {
          this.close();
          option.choose();
        };
        menu.append(button);
      }
      const bounds = this.host.getBoundingClientRect();
      menu.style.left = `${x - bounds.left + 8}px`;
      menu.style.top = `${y - bounds.top + 8}px`;
      this.host.append(menu);
      this.menu = menu;
      menu.style.left = `${Math.max(0, Math.min(x - bounds.left + 8, bounds.width - menu.offsetWidth))}px`;
      menu.style.top = `${Math.max(0, Math.min(y - bounds.top + 8, bounds.height - menu.offsetHeight))}px`;
      this.opened();
      (menu.firstElementChild as HTMLElement)?.focus();
    }, 450);
  }
  move(x: number, y: number) {
    if (this.anchor && Math.hypot(x - this.anchor[0], y - this.anchor[1]) > 4)
      this.cancelHold();
  }
  cancelHold() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.anchor = undefined;
  }
  close() {
    this.cancelHold();
    if (!this.menu) return;
    this.menu.remove();
    this.menu = undefined;
    this.closed();
  }
  private outside = (event: PointerEvent) => {
    if (this.menu && !this.menu.contains(event.target as Node)) this.close();
  };
  private key = (event: KeyboardEvent) => {
    if (!this.menu) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = Array.from(this.menu.children) as HTMLElement[];
      const index = items.indexOf(document.activeElement as HTMLElement);
      items[
        (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
          items.length
      ].focus();
    }
  };
  dispose() {
    this.close();
    document.removeEventListener("pointerdown", this.outside);
    document.removeEventListener("keydown", this.key);
  }
}
