import { useEffect, useId, useRef, useState } from "react";
import { FileClock, History, X } from "lucide-react";
import type { Backup } from "../project-backup";
import "./project-backups.css";

export function ProjectRecovery({
  backups,
  status,
  disabled,
  offerRecovery,
  onRestore,
  onDismiss,
}: {
  backups: Backup[];
  status: string;
  disabled: boolean;
  offerRecovery: boolean;
  onRestore: (backup: Backup) => void;
  onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const offered = useRef(false),
    dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const selectionGroup = useId();
  const selected = backups.find((backup) => backup.id === selectedId);
  const storageError = /failed|unavailable/i.test(status);
  function close() {
    setOpen(false);
    onDismiss?.();
  }
  function restore(backup: Backup) {
    if (disabled) return;
    close();
    onRestore(backup);
  }
  useEffect(() => {
    if (open) setSelectedId(null);
  }, [open]);
  useEffect(() => {
    if (offerRecovery && backups.length && !offered.current) {
      offered.current = true;
      setOpen(true);
    }
  }, [offerRecovery, backups.length]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  return (
    <div className="project-recovery-command">
      <button
        type="button"
        className="ribbon-button"
        aria-label="Backup"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <History size={28} aria-hidden="true" />
        <span className="ribbon-button-label">Backup</span>
      </button>
      <dialog
        ref={dialog}
        className="project-recovery-dialog"
        aria-labelledby={title}
        onCancel={() => {
          setOpen(false);
          onDismiss?.();
        }}
        onClose={() => {
          setOpen(false);
          onDismiss?.();
        }}
      >
        <header className="recovery-header">
          <FileClock size={20} aria-hidden="true" />
          <h2 id={title}>Project backups</h2>
          <button
            type="button"
            className="recovery-dismiss"
            aria-label="Close project backups"
            onClick={close}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="recovery-body">
          <p className="recovery-instruction">
            Select a backup to restore your project and its complete model
            timeline.
          </p>
          {storageError && (
            <p className="recovery-storage-error" role="alert">
              {status}
            </p>
          )}
          <div className="recovery-table-scroll">
            <table
              className="recovery-table"
              aria-label="Available project backups"
            >
              <thead>
                <tr>
                  <th scope="col" className="recovery-select-column">
                    <span className="recovery-sr-only">Select</span>
                  </th>
                  <th scope="col">Project</th>
                  <th scope="col">Saved</th>
                  <th scope="col">Snapshot</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => {
                  const previous = backup.id.endsWith(":previous");
                  const date = new Date(backup.savedAt);
                  return (
                    <tr
                      key={backup.id}
                      className={
                        selectedId === backup.id
                          ? "recovery-row selected"
                          : "recovery-row"
                      }
                      onClick={() => {
                        if (!disabled) setSelectedId(backup.id);
                      }}
                      onDoubleClick={() => restore(backup)}
                    >
                      <td>
                        <input
                          type="radio"
                          name={selectionGroup}
                          checked={selectedId === backup.id}
                          disabled={disabled}
                          aria-label={`Select ${backup.name}, ${date.toLocaleString()}, ${previous ? "previous" : "latest"} snapshot`}
                          onChange={() => setSelectedId(backup.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              restore(backup);
                            }
                          }}
                        />
                      </td>
                      <td className="recovery-project">
                        <span title={`${backup.name}.scanforge`}>
                          {backup.name}.scanforge
                        </span>
                      </td>
                      <td>
                        <time dateTime={date.toISOString()}>
                          <span>
                            {date.toLocaleDateString(undefined, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                          <span className="recovery-time">
                            {date.toLocaleTimeString(undefined, {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </time>
                      </td>
                      <td className="recovery-snapshot">
                        {previous ? "Previous" : "Latest"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!backups.length && (
              <div className="recovery-empty">
                <FileClock size={28} aria-hidden="true" />
                <p>No backups yet</p>
                <span>Backups appear here as you work on a project.</span>
              </div>
            )}
          </div>
        </div>
        <footer className="recovery-footer">
          <p>
            Open this list from <strong>Main → File → Backup</strong>.
          </p>
          <div className="recovery-actions">
            <button type="button" autoFocus onClick={close}>
              Close
            </button>
            <button
              type="button"
              className="accent"
              disabled={disabled || !selected}
              onClick={() => {
                if (selected) restore(selected);
              }}
            >
              Restore
            </button>
          </div>
        </footer>
      </dialog>
    </div>
  );
}
