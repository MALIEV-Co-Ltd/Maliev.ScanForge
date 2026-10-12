/** Age of the current unsaved changes, reset only when the document becomes clean. */
export class SaveReminderClock {
  private since?: number;
  setDirty(dirty: boolean, now = Date.now()) {
    if (!dirty) this.since = undefined;
    else this.since ??= now;
  }
  message(now = Date.now()): string | undefined {
    if (this.since === undefined) return;
    const minutes = Math.max(0, Math.floor((now - this.since) / 60_000));
    return minutes === 0
      ? "Unsaved · less than a minute"
      : `Unsaved for ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
}
