import { useEffect, useRef, useState } from "react";
import {
  BACKUP_INTERVAL_MS,
  IntervalBackupController,
  listBackups,
  removeBackup,
  type Backup,
} from "../project-backup";
import type { ProjectSession } from "../project-file";
import { writeAutomaticProjectBackup } from "../automatic-project-backup";
import { hasPriorityScanPreparation } from "../scan-background-preparation";

export function useProjectBackups(
  session: ProjectSession,
  enabled: boolean,
  captureThumbnail?: () => Promise<Blob | null>,
) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [status, setStatus] = useState("Checking backups…");
  const [offerRecovery, setOfferRecovery] = useState(false);
  const controller = useRef<IntervalBackupController<ProjectSession> | null>(
    null,
  );
  const latest = useRef({ session, enabled, captureThumbnail });
  latest.current = { session, enabled, captureThumbnail };
  const deleting = useRef(false);
  const activeAutomatic = useRef<AbortController | null>(null);
  useEffect(() => {
    let mounted = true;
    let ready = false;
    const writer = new IntervalBackupController<ProjectSession>(
      async (id, snapshot, allowed) => {
        if (mounted) setStatus("Backing up…");
        const cancel = new AbortController();
        activeAutomatic.current = cancel;
        try {
          const result = await writeAutomaticProjectBackup(
            id,
            snapshot,
            allowed,
            latest.current.captureThumbnail,
            cancel.signal,
          );
          if (result === false) {
            if (mounted)
              setStatus("Backup postponed until preparation finishes.");
            return false;
          }
          if (mounted) {
            setStatus("Backup ready");
            setBackups(await listBackups());
          }
        } finally {
          if (activeAutomatic.current === cancel)
            activeAutomatic.current = null;
        }
      },
      async (id) => {
        await removeBackup(id);
        if (mounted) setBackups(await listBackups());
      },
      (error) => {
        if (mounted)
          setStatus(
            `Backup failed: ${error instanceof Error ? error.message : String(error)}. Save a project file.`,
          );
      },
    );
    controller.current = writer;
    void listBackups()
      .then((items) => {
        if (mounted) {
          setBackups(items);
          setOfferRecovery(items.length > 0);
          setStatus("Backup ready");
          ready = true;
        }
      })
      .catch((error) => {
        if (mounted)
          setStatus(
            `Backup unavailable: ${String(error)}. Save a project file.`,
          );
      });
    const timer = setInterval(() => {
      if (!ready || deleting.current || hasPriorityScanPreparation()) return;
      const { session: snapshot, enabled: eligible } = latest.current;
      if (!snapshot.projectId) return;
      writer.update(
        snapshot.projectId,
        snapshot,
        [
          snapshot.project.name,
          snapshot.project.entities,
          snapshot.project.authoring?.sketch,
          snapshot.project.authoring?.sketches,
          snapshot.project.authoring?.activeSketchId,
          snapshot.history,
          snapshot.future,
        ],
        eligible,
      );
      void writer.tick();
    }, BACKUP_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
      writer.stop();
      activeAutomatic.current?.abort();
      controller.current = null;
    };
  }, []);
  return {
    backups,
    status,
    offerRecovery,
    dismissRecovery: () => setOfferRecovery(false),
    deleteBackup: async (backup: Pick<Backup, "id">) => {
      if (!controller.current) throw new Error("Backups are not ready.");
      deleting.current = true;
      activeAutomatic.current?.abort();
      try {
        await controller.current.delete(backup.id);
      } finally {
        deleting.current = false;
      }
    },
  };
}
