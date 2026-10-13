import { useEffect, useRef, useState } from "react";
import {
  BackupQueue,
  listBackups,
  writeBackup,
  type Backup,
} from "../project-backup";
import { encodeProjectFile, type ProjectSession } from "../project-file";

export function useProjectBackups(session: ProjectSession, enabled: boolean) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [status, setStatus] = useState("Checking backups…");
  const [ready, setReady] = useState(false);
  const [offerRecovery, setOfferRecovery] = useState(false);
  const id = useRef(crypto.randomUUID());
  const queue = useRef<BackupQueue<ProjectSession> | null>(null);
  const latest = useRef(session);
  latest.current = session;
  const eligible = useRef(enabled);
  eligible.current = enabled;
  useEffect(() => {
    let mounted = true;
    const writer = new BackupQueue<ProjectSession>(
      async (snapshot) => {
        if (mounted) setStatus("Backing up…");
        const file = await encodeProjectFile(snapshot);
        const backup = {
          id: id.current,
          name: snapshot.project.name,
          savedAt: Date.now(),
          file,
        };
        await writeBackup(backup);
        if (mounted) {
          setStatus(
            `Backed up at ${new Date(backup.savedAt).toLocaleTimeString()}`,
          );
          setBackups(await listBackups());
        }
      },
      (error) => {
        if (mounted)
          setStatus(
            `Backup failed: ${error instanceof Error ? error.message : String(error)}. Save a project file.`,
          );
      },
    );
    queue.current = writer;
    void listBackups()
      .then((items) => {
        if (mounted) {
          setBackups(items);
          setOfferRecovery(items.length > 0);
          setStatus("Backup ready");
          setReady(true);
        }
      })
      .catch((error) => {
        if (mounted) {
          setStatus(
            `Backup unavailable: ${String(error)}. Save a project file.`,
          );
          setReady(true);
        }
      });
    const flush = () => {
      if (eligible.current) writer.enqueue(latest.current);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush);
    return () => {
      mounted = false;
      writer.stop();
      queue.current = null;
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", flush);
    };
  }, []);
  useEffect(() => {
    if (!ready || !enabled) return;
    const timer = setTimeout(() => queue.current?.enqueue(session), 750);
    return () => clearTimeout(timer);
  }, [
    session.project.name,
    session.project.entities,
    session.project.authoring?.sketch,
    session.project.authoring?.sketches,
    session.project.authoring?.activeSketchId,
    session.history,
    session.future,
    ready,
    enabled,
  ]);
  return {
    backups,
    status,
    offerRecovery,
    dismissRecovery: () => setOfferRecovery(false),
  };
}
