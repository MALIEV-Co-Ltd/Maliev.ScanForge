import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { RibbonCommandIcon } from "./RibbonCommandIcon";
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
  const active =
    RIBBON_TABS.find((tab) => tab.id === activeTab) ?? RIBBON_TABS[0];
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
      <div
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
                    disabled={!availability.available}
                    title={availability.reason}
                    aria-label={tool.label}
                    onClick={
                      availability.available && tool.action
                        ? actions[tool.action]
                        : undefined
                    }
                  >
                    <RibbonCommandIcon command={tool.id} />
                    <span className="ribbon-button-label">{tool.label}</span>
                  </button>
                );
              })}
            </div>
            <span className="ribbon-group-title">{group.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
