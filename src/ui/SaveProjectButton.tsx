import { useEffect, useRef, useState } from "react";
import { Save } from "./GeneratedUiIcons";
import { HeaderIconButton } from "./HeaderIconButton";
import { SaveReminderClock } from "./save-reminder";

export function SaveProjectButton({
  dirty,
  disabled,
  onSave,
}: {
  dirty: boolean;
  disabled: boolean;
  onSave: () => void;
}) {
  const clock = useRef(new SaveReminderClock());
  const [reminder, setReminder] = useState<string>();
  useEffect(() => {
    clock.current.setDirty(dirty);
    const update = () => setReminder(clock.current.message());
    update();
    if (!dirty) return;
    const timer = setInterval(update, 15_000);
    return () => clearInterval(timer);
  }, [dirty]);
  return (
    <div className={`save-project-action${dirty ? " needs-save" : ""}`}>
      <HeaderIconButton
        label="Save project"
        disabled={disabled}
        onClick={onSave}
      >
        <Save size={17} aria-hidden="true" />
      </HeaderIconButton>
      {dirty && reminder && (
        <span className="save-reminder" role="status" aria-live="off">
          {reminder}
        </span>
      )}
    </div>
  );
}
