import { Search } from "./GeneratedUiIcons";
import type { ButtonHTMLAttributes } from "react";
import "./ToolPanel.css";

export function PreviewButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="tool-preview-button"
      aria-label="Preview"
      title="Preview"
    >
      <Search size={18} aria-hidden="true" />
    </button>
  );
}
