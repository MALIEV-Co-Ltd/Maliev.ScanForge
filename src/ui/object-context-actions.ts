import type { Entity } from "../types";
import { objectDuplicateSupported } from "../object-operations";
import type { ContextAction } from "./ContextMenu";

export function objectContextActions(
  entity: Entity | undefined,
  busy: boolean,
  handlers: {
    properties: () => void;
    duplicate: () => void;
    rename: () => void;
    visibility: () => void;
    selectable: () => void;
    lock: () => void;
    edit: () => void;
    remove: () => void;
  },
): ContextAction[] {
  const blocked = busy || !entity;
  return [
    {
      label: "Object properties",
      disabled: blocked || entity?.locked || entity?.selectable === false,
      run: handlers.properties,
    },
    {
      label: "Duplicate",
      disabled: blocked || !objectDuplicateSupported(entity),
      run: handlers.duplicate,
    },
    { label: "Rename…", disabled: blocked, run: handlers.rename },
    {
      label: entity?.visible ? "Hide object" : "Show object",
      disabled: blocked,
      run: handlers.visibility,
    },
    {
      label:
        entity?.selectable === false ? "Make selectable" : "Make unselectable",
      disabled: blocked,
      run: handlers.selectable,
    },
    {
      label: entity?.locked ? "Unlock object" : "Lock object",
      disabled: blocked,
      run: handlers.lock,
    },
    {
      label: "Edit scan selection",
      disabled:
        blocked ||
        entity?.locked ||
        entity?.selectable === false ||
        entity?.kind !== "mesh",
      run: handlers.edit,
    },
    {
      label: "Delete object",
      disabled: blocked || entity?.locked,
      run: handlers.remove,
    },
  ];
}
