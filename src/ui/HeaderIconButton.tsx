import type { ReactNode } from "react";

export function HeaderIconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className="header-icon-button"
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span className="header-tooltip" role="tooltip">
        {label}
      </span>
    </button>
  );
}
