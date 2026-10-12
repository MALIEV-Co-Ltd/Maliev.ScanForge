import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { RibbonCommandIcon } from "./RibbonCommandIcon";
import { ribbonVerification } from "./ribbon-verification";
import "./ribbon-verification.css";
import { ribbonOverflowEdges } from "./ribbon-overflow";
import {
  RIBBON_TABS,
  ribbonToolAvailability,
  type RibbonActions,
  type RibbonState,
} from "./ribbon-model";

export interface RibbonProps extends RibbonState {
  activeTab: string;
  onTabChange: (id: string) => void;
  actions: RibbonActions;
  utilityHeader?: ReactNode;
}

export function Ribbon({
  activeTab,
  onTabChange,
  actions,
  utilityHeader,
  ...state
}: RibbonProps) {
  const instance = useId();
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const tools = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const active =
    RIBBON_TABS.find((tab) => tab.id === activeTab) ?? RIBBON_TABS[0];
  function updateEdges() {
    const panel = tools.current;
    if (!panel) return;
    const { left, right } = ribbonOverflowEdges(
      panel.scrollLeft,
      panel.clientWidth,
      panel.scrollWidth,
    );
    setEdges((previous) =>
      previous.left === left && previous.right === right
        ? previous
        : { left, right },
    );
  }
  useEffect(() => {
    const panel = tools.current;
    if (!panel) return;
    panel.scrollLeft = 0;
    updateEdges();
    const observer = new ResizeObserver(updateEdges);
    observer.observe(panel);
    for (const group of panel.children) observer.observe(group);
    return () => observer.disconnect();
  }, [active.id]);
  useEffect(() => {
    const panel = tools.current;
    if (!panel) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || panel.scrollWidth <= panel.clientWidth) return;
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? panel.clientWidth
            : 1;
      const delta =
        (Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY) * unit;
      if (!delta) return;
      event.preventDefault();
      panel.scrollLeft += delta;
      updateEdges();
    };
    panel.addEventListener("wheel", wheel, { passive: false });
    return () => panel.removeEventListener("wheel", wheel);
  }, [active.id]);
  function scrollTools(direction: number) {
    const panel = tools.current;
    panel?.scrollBy({
      left: direction * Math.max(160, panel.clientWidth * 0.65),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  function navigateTabs(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % RIBBON_TABS.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + RIBBON_TABS.length) % RIBBON_TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = RIBBON_TABS.length - 1;
    else return;
    event.preventDefault();
    onTabChange(RIBBON_TABS[next].id);
    tabButtons.current[next]?.focus();
    tabButtons.current[next]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }
  return (
    <section className="ribbon" aria-label="Workspace commands">
      <div className="ribbon-tab-row">
        <div
          className="ribbon-tabs"
          role="tablist"
          aria-label="Command categories"
        >
          {RIBBON_TABS.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              ref={(element) => {
                tabButtons.current[index] = element;
              }}
              id={`${instance}-tab-${tab.id}`}
              aria-controls={`${instance}-panel-${tab.id}`}
              aria-selected={active.id === tab.id}
              tabIndex={active.id === tab.id ? 0 : -1}
              className={active.id === tab.id ? "active" : undefined}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={(event) => navigateTabs(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {utilityHeader && (
          <div className="header-reveal">
            <button
              className="header-reveal-trigger"
              aria-label="Show project actions"
              type="button"
            />
            {utilityHeader}
          </div>
        )}
      </div>
      <div className="ribbon-verification-legend">
        Verified commands enabled · In progress and planned commands disabled
      </div>
      <div className="ribbon-tools-shell">
        <div
          ref={tools}
          onScroll={updateEdges}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              scrollTools(event.key === "ArrowLeft" ? -1 : 1);
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              event.currentTarget.scrollLeft =
                event.key === "Home" ? 0 : event.currentTarget.scrollWidth;
            }
          }}
          className="ribbon-tools"
          role="tabpanel"
          id={`${instance}-panel-${active.id}`}
          aria-labelledby={`${instance}-tab-${active.id}`}
          tabIndex={0}
        >
          {active.groups.map((group) => (
            <div
              className="ribbon-group"
              role="group"
              aria-label={group.label}
              key={group.label}
            >
              <div className="ribbon-group-tools">
                {group.tools.map((tool) => {
                  const verification = ribbonVerification(
                    tool.id,
                    !!tool.action,
                  );
                  const availability = ribbonToolAvailability(
                    tool,
                    state,
                    actions,
                  );
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      className="ribbon-button"
                      data-command={tool.id}
                      data-verification={verification.status}
                      disabled={!availability.available}
                      title={availability.reason}
                      aria-label={tool.label}
                      aria-description={availability.reason}
                      onClick={
                        availability.available && tool.action
                          ? actions[tool.action]
                          : undefined
                      }
                    >
                      <RibbonCommandIcon command={tool.id} />
                      <span className="ribbon-button-label">{tool.label}</span>
                      {verification.status !== "verified" && (
                        <span
                          className="ribbon-verification-badge"
                          aria-hidden="true"
                        >
                          {verification.status === "planned"
                            ? "Planned"
                            : "In progress"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <span className="ribbon-group-title">{group.label}</span>
            </div>
          ))}
        </div>
        {edges.left && (
          <button
            type="button"
            className="ribbon-scroll-hint ribbon-scroll-left"
            aria-label="Show previous tools"
            aria-controls={`${instance}-panel-${active.id}`}
            title="More tools to the left"
            onClick={() => scrollTools(-1)}
          >
            <span aria-hidden="true">‹</span>
          </button>
        )}
        {edges.right && (
          <button
            type="button"
            className="ribbon-scroll-hint ribbon-scroll-right"
            aria-label="Show more tools"
            aria-controls={`${instance}-panel-${active.id}`}
            title="More tools to the right"
            onClick={() => scrollTools(1)}
          >
            <span aria-hidden="true">›</span>
          </button>
        )}
      </div>
    </section>
  );
}
