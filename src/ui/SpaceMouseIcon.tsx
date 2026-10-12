/** Short motion cap on the weighted base of a desktop 6-axis controller. */
export function SpaceMouseIcon({ size = 19 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon="spacemouse"
    >
      <path d="M5 14.5 2.5 18v2l3 1.5h13l3-1.5v-2L19 14.5" />
      <path d="M2.5 18 6 19.5h12l3.5-1.5" />
      <ellipse cx="12" cy="6" rx="6" ry="3" />
      <path d="M6 6v7c0 1.7 2.7 3 6 3s6-1.3 6-3V6" />
      <path d="M6 11c0 1.7 2.7 3 6 3s6-1.3 6-3" />
      <path d="M6 17h2m8 0h2" />
    </svg>
  );
}
