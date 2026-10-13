import { useEffect, useId, useRef, useState } from "react";
import { History } from "lucide-react";
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
  const offered = useRef(false),
    dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
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
        aria-label="Backup and recovery"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <History size={28} aria-hidden="true" />
        <span className="ribbon-button-label">Backup and recovery</span>
      </button>
      <span className="backup-status" role="status" title={status}>
        {status}
      </span>
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
        <h2 id={title}>Project backups</h2>
        <p>Restore a saved project and its complete model timeline.</p>
        <p role="status">{status}</p>
        {!backups.length && <p>No saved backups yet.</p>}
        <div className="project-backups-list">
          {backups.map((backup) => (
            <button
              key={backup.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onRestore(backup);
              }}
            >
              Restore {backup.name} ·{" "}
              {new Date(backup.savedAt).toLocaleString()}
              {backup.id.endsWith(":previous") ? " (previous)" : ""}
            </button>
          ))}
        </div>
        <button type="button" autoFocus onClick={() => setOpen(false)}>
          Close
        </button>
      </dialog>
    </div>
  );
}
