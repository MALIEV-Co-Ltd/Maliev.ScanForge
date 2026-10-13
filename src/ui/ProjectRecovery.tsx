import { useEffect, useId, useRef, useState } from "react";
import { FileClock, History, X } from "lucide-react";
import type { Backup } from "../project-backup";
import "./project-backups.css";

function BackupThumbnail({ file }: { file?: Blob }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? (
    <img className="recovery-thumbnail" src={url} alt="" />
  ) : (
    <span
      className="recovery-thumbnail recovery-thumbnail-empty"
      aria-hidden="true"
    >
      <FileClock size={20} />
    </span>
  );
}

export function ProjectRecovery({
  backups,
  status,
  disabled,
  offerRecovery,
  onRestore,
  onDismiss,
  onDelete,
}: {
  backups: Backup[];
  status: string;
  disabled: boolean;
  offerRecovery: boolean;
  onRestore: (backup: Backup) => void;
  onDismiss?: () => void;
  onDelete?: (backup: Backup) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
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
    if (disabled || deleting || confirmDelete) return;
    close();
    onRestore(backup);
  }
  useEffect(() => {
    if (open) {
      setSelectedId(null);
      setConfirmDelete(false);
      setDeleteError("");
    }
  }, [open]);
  async function deleteSelected() {
    if (!selected || !onDelete) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await onDelete(selected);
      setSelectedId(null);
      setConfirmDelete(false);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  }
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
                        if (!disabled && !deleting) {
                          setSelectedId(backup.id);
                          setConfirmDelete(false);
                        }
                      }}
                      onDoubleClick={() => restore(backup)}
                    >
                      <td>
                        <input
                          type="radio"
                          name={selectionGroup}
                          checked={selectedId === backup.id}
                          disabled={disabled || deleting}
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
                        <BackupThumbnail file={backup.thumbnail} />
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
          {deleteError && (
            <p className="recovery-storage-error" role="alert">
              Could not delete backup: {deleteError}
            </p>
          )}
          {confirmDelete && selected && (
            <div
              className="recovery-delete-confirm"
              role="group"
              aria-label="Confirm backup deletion"
            >
              <p>
                Delete the backup for <strong>{selected.name}</strong>? This
                removes its saved snapshots. Your open project stays unchanged.
                If this is the open project, automatic backups stop until you
                open another project.
              </p>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void deleteSelected()}
              >
                {deleting ? "Deleting…" : "Delete backup"}
              </button>
            </div>
          )}
        </div>
        <footer className="recovery-footer">
          <p>
            Open this list from <strong>Main → File → Backup</strong>.
          </p>
          <div className="recovery-actions">
            {onDelete && (
              <button
                type="button"
                disabled={disabled || deleting || !selected || confirmDelete}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </button>
            )}
            <button type="button" autoFocus onClick={close}>
              Close
            </button>
            <button
              type="button"
              className="accent"
              disabled={disabled || deleting || confirmDelete || !selected}
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
