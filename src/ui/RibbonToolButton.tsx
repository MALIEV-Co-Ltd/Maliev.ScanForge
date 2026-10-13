import { useId, useRef, useState } from "react";
import { Milestone, Wrench } from "lucide-react";
import { RibbonCommandIcon } from "./RibbonCommandIcon";
import { ribbonVerification } from "./ribbon-verification";
import {
  ribbonToolAvailability,
  type RibbonActions,
  type RibbonState,
  type RibbonTool,
} from "./ribbon-model";
import "./ribbon-layout.css";

export function RibbonToolButton({
  tool,
  state,
  actions,
  onExecuted,
}: {
  tool: RibbonTool;
  state: RibbonState;
  actions: RibbonActions;
  onExecuted?: () => void;
}) {
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const verification = ribbonVerification(tool.id, !!tool.action);
  const availability = ribbonToolAvailability(tool, state, actions);
  const command = (
    <button
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
          ? () => {
              actions[tool.action!]?.();
              onExecuted?.();
            }
          : undefined
      }
    >
      <RibbonCommandIcon command={tool.id} />
      <span className="ribbon-button-label">{tool.label}</span>
      {verification.status !== "verified" && (
        <span
          className="ribbon-status-icon"
          data-status-icon={verification.status}
          aria-hidden="true"
        >
          {verification.status === "planned" ? <Milestone /> : <Wrench />}
        </span>
      )}
    </button>
  );
  if (!tool.options?.length) return command;
  return (
    <div className="ribbon-split-command">
      {command}
      <button
        type="button"
        className="ribbon-options-toggle"
        aria-label={`${tool.label} options`}
        title={`${tool.label} options`}
        popoverTarget={menuId}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setPosition({
            left: Math.max(8, Math.min(bounds.left, window.innerWidth - 272)),
            top: bounds.bottom + 4,
          });
        }}
      >
        <span aria-hidden="true">▾</span>
      </button>
      <div
        id={menuId}
        ref={menu}
        popover="auto"
        className="ribbon-options"
        role="group"
        aria-label={`${tool.label} options`}
        style={position}
        onKeyDown={(event) => {
          if (event.key === "Escape") menu.current?.hidePopover();
        }}
      >
        {tool.options.map((option) => (
          <RibbonToolButton
            key={option.id}
            tool={option}
            state={state}
            actions={actions}
            onExecuted={() => menu.current?.hidePopover()}
          />
        ))}
      </div>
    </div>
  );
}
