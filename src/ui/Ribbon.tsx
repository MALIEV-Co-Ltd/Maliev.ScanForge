import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import {
  AlignCenter,
  ArrowUpFromLine,
  Blend,
  Box,
  Circle,
  Cone,
  Cylinder,
  Download,
  Eye,
  FolderOpen,
  FilePlus,
  Pencil,
  Grid2X2,
  HelpCircle,
  Layers,
  Maximize,
  MousePointer2,
  Move3D,
  Palette,
  Redo2,
  Rotate3D,
  Ruler,
  Save,
  ScanLine,
  Settings,
  Sparkles,
  Spline,
  Square,
  Trash2,
  Triangle,
  Undo2,
  Waves,
  type LucideIcon,
} from "lucide-react";
import {
  RIBBON_TABS,
  ribbonToolAvailability,
  type RibbonActions,
  type RibbonIcon,
  type RibbonState,
} from "./ribbon-model";

const icons: Record<RibbonIcon, LucideIcon> = {
  newDocument: FilePlus,
  editScan: Pencil,
  folder: FolderOpen,
  save: Save,
  undo: Undo2,
  redo: Redo2,
  select: MousePointer2,
  fit: Maximize,
  view: Eye,
  plane: Square,
  cylinder: Cylinder,
  cone: Cone,
  sphere: Circle,
  box: Box,
  align: AlignCenter,
  transform: Move3D,
  section: ScanLine,
  extrude: ArrowUpFromLine,
  revolve: Rotate3D,
  boolean: Blend,
  measure: Ruler,
  deviation: Waves,
  cleanup: Sparkles,
  delete: Trash2,
  export: Download,
  settings: Settings,
  wireframe: Triangle,
  color: Palette,
  curve: Spline,
  surface: Layers,
  pattern: Grid2X2,
  help: HelpCircle,
};

function CommandIcon({
  icon,
  fallback: Icon,
}: {
  icon: RibbonIcon;
  fallback: LucideIcon;
}) {
  if (icon === "editScan" || icon === "plane")
    return (
      <img
        className="ribbon-command-image"
        src={icon === "plane" ? "/icons/plane.png" : "/icons/edit-scan.png"}
        alt=""
        aria-hidden="true"
      />
    );
  if (
    icon === "cylinder" ||
    icon === "cone" ||
    icon === "sphere" ||
    icon === "box"
  )
    return (
      <svg
        className="ribbon-primitive-icon"
        viewBox="0 0 32 32"
        aria-hidden="true"
        stroke="#705817"
        strokeWidth="1.1"
        strokeLinejoin="round"
      >
        {icon === "cylinder" && (
          <>
            <path fill="#e5b837" d="M6 8v17c0 5 20 5 20 0V8" />
            <ellipse cx="16" cy="8" rx="10" ry="4" fill="#ffe185" />
            <path d="M6 25c0 5 20 5 20 0" fill="none" />
          </>
        )}
        {icon === "cone" && (
          <>
            <path d="M16 3 4 25c0 6 24 6 24 0Z" fill="#f3c84d" />
            <path d="M4 25c0-5 24-5 24 0" strokeDasharray="2 2" fill="none" />
            <path d="M16 3 21 27" fill="none" />
          </>
        )}
        {icon === "sphere" && (
          <>
            <circle cx="16" cy="16" r="12" fill="#f3c84d" />
            <ellipse cx="16" cy="16" rx="5" ry="12" fill="#ffe185" />
            <ellipse cx="16" cy="16" rx="12" ry="4" fill="none" />
          </>
        )}
        {icon === "box" && (
          <>
            <path d="m16 3 12 6-12 7L4 9Z" fill="#ffe185" />
            <path d="m4 9 12 7v13L4 22Z" fill="#f3c84d" />
            <path d="m16 16 12-7v13l-12 7Z" fill="#c79729" />
          </>
        )}
      </svg>
    );
  return (
    <Icon
      className={`ribbon-line-icon icon-${icon}`}
      size={30}
      strokeWidth={1.7}
      aria-hidden="true"
    />
  );
}

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
                const Icon = icons[tool.icon];
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
                    <CommandIcon icon={tool.icon} fallback={Icon} />
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
