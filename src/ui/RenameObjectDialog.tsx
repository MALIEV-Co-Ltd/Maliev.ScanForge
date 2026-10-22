import { useState } from "react";
export function RenameObjectDialog({
  name,
  count = 1,
  onRename,
  onClose,
}: {
  name: string;
  count?: number;
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
        <h3>{count > 1 ? `Rename ${count} objects` : "Rename object"}</h3>
        {count > 1 && (
          <p>
            Names will be numbered: {value.trim() || "name"} - 1,{" "}
            {value.trim() || "name"} - 2, …
          </p>
        )}
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
