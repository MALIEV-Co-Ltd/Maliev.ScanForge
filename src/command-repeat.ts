/** Remember command identities, never closures or object IDs from an older selection. */
export class CommandRepeat {
  private commands: Record<string, (() => void) | undefined> = {};
  private last: string | null = null;
  private blocked: () => boolean = () => false;

  configure(
    commands: Record<string, (() => void) | undefined>,
    blocked: () => boolean,
  ) {
    this.commands = commands;
    this.blocked = blocked;
  }

  inspect() {
    return {
      lastCommand: this.last,
      canRepeat: !!this.last && !!this.commands[this.last] && !this.blocked(),
      commands: Object.keys(this.commands).map((name) => ({
        name,
        available: !!this.commands[name] && !this.blocked(),
      })),
    };
  }

  run(name = this.last): { command: string; status: "launched" } {
    if (!name) throw new Error("No previous repeatable command.");
    if (this.blocked())
      throw new Error("Finish the active operation or close the dialog first.");
    const command = Object.hasOwn(this.commands, name)
      ? this.commands[name]
      : undefined;
    if (!command)
      throw new Error(
        `Command is unavailable for the current selection: ${name}`,
      );
    command();
    this.last = name;
    return { command: name, status: "launched" };
  }
}
