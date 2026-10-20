const sections = [
  { id: "appearance", label: "Appearance" },
  { id: "spacemouse", label: "SpaceMouse" },
  { id: "import", label: "Scan import" },
  { id: "agents", label: "AI agents" },
] as const;

export type SettingsSection = (typeof sections)[number]["id"];

export function SettingsTabs({
  value,
  onChange,
}: {
  value: SettingsSection;
  onChange: (section: SettingsSection) => void;
}) {
  return (
    <div
      className="settings-tabs"
      role="tablist"
      aria-label="Settings categories"
      onKeyDown={(event) => {
        const current = sections.findIndex((section) => section.id === value);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? sections.length - 1
              : event.key === "ArrowRight"
                ? (current + 1) % sections.length
                : event.key === "ArrowLeft"
                  ? (current + sections.length - 1) % sections.length
                  : -1;
        if (next < 0) return;
        event.preventDefault();
        onChange(sections[next].id);
        event.currentTarget
          .querySelector<HTMLButtonElement>(
            `[data-section="${sections[next].id}"]`,
          )
          ?.focus();
      }}
    >
      {sections.map((section) => (
        <button
          key={section.id}
          id={`settings-tab-${section.id}`}
          data-section={section.id}
          role="tab"
          aria-selected={value === section.id}
          aria-controls={`settings-panel-${section.id}`}
          tabIndex={value === section.id ? 0 : -1}
          onClick={() => onChange(section.id)}
        >
          {section.label}
        </button>
      ))}
    </div>
  );
}
