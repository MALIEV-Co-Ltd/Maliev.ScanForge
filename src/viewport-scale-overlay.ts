import type { ViewportScale } from "./viewport-scale";
import { formatScaleMm } from "./viewport-scale";
import "./viewport-scale.css";

export class ViewportScaleOverlay {
  readonly element = document.createElement("div");
  private readonly label = document.createElement("span");
  private readonly bar = document.createElement("i");
  private readonly grid = document.createElement("span");
  private previous = "";
  constructor(container: HTMLElement) {
    this.element.className = "viewport-scale";
    this.element.setAttribute("role", "img");
    this.element.append(this.label, this.bar, this.grid);
    container.append(this.element);
  }
  update(scale: ViewportScale | null, spacing: number, visible: boolean): void {
    this.element.hidden = !scale;
    if (!scale) return;
    const label = formatScaleMm(scale.distanceMm);
    const grid = visible ? `Grid ${formatScaleMm(spacing)}` : "Grid off";
    const width = scale.widthPx.toFixed(2);
    const key = `${label}|${grid}|${width}`;
    if (key === this.previous) return;
    this.previous = key;
    this.label.textContent = label;
    this.grid.textContent = grid;
    this.bar.style.width = `${width}px`;
    this.element.setAttribute(
      "aria-label",
      `Scale ${label} at view center; ${grid}`,
    );
    this.element.title =
      "Scale at the view center; perspective distances vary with depth";
  }
  dispose(): void {
    this.element.remove();
  }
}
