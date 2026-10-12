import type { SVGProps } from "react";

type SpaceMouseIconProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

/**
 * Original SpaceMouse-inspired wireframe icon.
 * Uses currentColor and is suitable for 20–28 px UI placements.
 * Accessible naming should be applied to the containing button if icon-only.
 */
export function SpaceMouseIcon({ size = 22, ...props }: SpaceMouseIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.65}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon="spacemouse"
      {...props}
    >
      <ellipse cx="24" cy="10" rx="8.6" ry="3.2" />
      <path d="M15.4 10c-.2 6.2-1.5 11.6-3.4 16.2 5.3 4.7 18.7 4.7 24 0-1.9-4.6-3.2-10-3.4-16.2" />
      <path d="M12 26.2C7 28.5 4 32.1 4 36.4 4 41.3 12.7 44 24 44s20-2.7 20-7.6c0-4.3-3-7.9-8-10.2" />
      <path d="M4.4 37.4C14.5 41.8 33.5 41.8 43.6 37.4" />
    </svg>
  );
}
