import { useState } from "react";
export function RenameObjectDialog({
  name,
  onRename,
  onClose,
}: {
  name: string;
  onRename: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(name);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-label="Rename object"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onRename(value.trim());
        }}
      >
        <h3>Rename object</h3>
        <label className="field">
          Name
          <input
            autoFocus
            value={value}
            maxLength={200}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={!value.trim()}>
            Rename
          </button>
        </footer>
      </form>
    </div>
  );
}
