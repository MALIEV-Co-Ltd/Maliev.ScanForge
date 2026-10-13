import { useEffect, useRef, useState } from "react";
import "./save-project-dialog.css";

export function SaveProjectDialog({
  name,
  onSave,
  onCancel,
}: {
  name: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const opener = useRef(
    typeof document === "undefined"
      ? null
      : (document.activeElement as HTMLElement | null),
  );
  useEffect(
    () => () => {
      if (opener.current?.isConnected) opener.current.focus();
    },
    [],
  );
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="modal save-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-project-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          if (event.key === "Tab") {
            const controls = event.currentTarget.querySelectorAll<HTMLElement>(
              "input, button:not(:disabled)",
            );
            const first = controls[0],
              last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <h2 id="save-project-title">Save project</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = draft.trim();
            if (value) onSave(value);
          }}
        >
          <label htmlFor="save-project-name">Project name</label>
          <input
            id="save-project-name"
            autoFocus
            required
            maxLength={200}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="save-project-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" disabled={!draft.trim()}>
              Save project
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
