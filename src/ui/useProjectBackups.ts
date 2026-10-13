import { useEffect, useRef, useState } from "react";
import {
  BACKUP_INTERVAL_MS,
  IntervalBackupController,
  listBackups,
  removeBackup,
  writeBackup,
  type Backup,
} from "../project-backup";
import { encodeProjectFile, type ProjectSession } from "../project-file";

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
  useEffect(() => {
    let mounted = true;
    let ready = false;
    const writer = new IntervalBackupController<ProjectSession>(
      async (id, snapshot, allowed) => {
        if (mounted) setStatus("Backing up…");
        let thumbnail: Blob | null = null;
        try {
          thumbnail = (await latest.current.captureThumbnail?.()) ?? null;
        } catch {
          /* A thumbnail failure must never prevent project recovery. */
        }
        const file = await encodeProjectFile(snapshot);
        if (!allowed()) return;
        const backup: Backup = {
          id,
          name: snapshot.project.name,
          savedAt: Date.now(),
          file,
          ...(thumbnail ? { thumbnail } : {}),
        };
        await writeBackup(backup);
        if (mounted) {
          setStatus("Backup ready");
          setBackups(await listBackups());
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
      if (!ready || deleting.current) return;
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
      try {
        await controller.current.delete(backup.id);
      } finally {
        deleting.current = false;
      }
    },
  };
}
