import type { Entity } from "./types";
import type { ScanToolOperation } from "./scan-tools";
import { reconstructionTargets } from "./scan-reconstruction-targets";
export type ShrinkwrapParameters = {
  kind: "shrinkwrap";
  sampleInterval?: number;
  gapFill?: number;
  organicShape?: boolean;
  extraThickness?: number;
  maxDeviation?: number;
  scope?: "whole" | "selected" | "isolated";
  targetIds?: string[];
};
/** The only public-to-kernel binding; masks and geometry come from current workspace objects. */
export function bindShrinkwrap(
  source: Entity,
  parameters: ShrinkwrapParameters,
  entities: Entity[],
  selected?: Uint8Array | null,
): Extract<ScanToolOperation, { kind: "shrinkwrap" }> {
  if (
    source.kind !== "mesh" ||
    source.kernelId ||
    source.parametric ||
    !source.visible ||
    source.locked
  )
    throw Error("ShrinkWrap requires a visible, unlocked raw mesh source.");
  const { targetIds = [], ...settings } = parameters;
  const scope = settings.scope ?? "whole";
  const values = {
    sampleInterval: settings.sampleInterval ?? 0.5,
    gapFill: settings.gapFill ?? 0,
    extraThickness: settings.extraThickness ?? 0,
    maxDeviation: settings.maxDeviation ?? 0.1,
  };
  if (
    !Number.isFinite(values.sampleInterval) ||
    values.sampleInterval <= 0 ||
    !Number.isFinite(values.maxDeviation) ||
    values.maxDeviation <= 0 ||
    !Number.isFinite(values.gapFill) ||
    values.gapFill < 0 ||
    !Number.isFinite(values.extraThickness) ||
    values.extraThickness < 0
  )
    throw Error(
      "ShrinkWrap needs positive finite sampling and deviation, and nonnegative finite gap fill and thickness.",
    );
  if (
    settings.organicShape !== undefined &&
    typeof settings.organicShape !== "boolean"
  )
    throw Error("Organic shape must be a boolean.");
  if (!["whole", "selected", "isolated"].includes(scope))
    throw Error("Choose whole, selected or isolated ShrinkWrap scope.");
  const operation = {
    ...settings,
    ...values,
    organicShape: settings.organicShape ?? false,
    scope,
  };
  if (scope === "whole") {
    const targets = targetIds.map((id) => {
      const entity = entities.find((e) => e.id === id);
      if (!entity?.visible)
        throw Error("ShrinkWrap references must exist and be visible.");
      return entity;
    });
    return { ...operation, targets: reconstructionTargets(source, targets) };
  }
  if (targetIds.length)
    throw Error("Additional ShrinkWrap references require whole scope.");
  const count = source.positions.length / 9;
  if (!Number.isInteger(count) || count < 1)
    throw Error("ShrinkWrap requires complete triangles.");
  const hidden = source.meshSelection?.hidden ?? [];
  if (hidden.some((id) => !Number.isInteger(id) || id < 0 || id >= count))
    throw Error("Hidden triangle state is invalid; reset isolation first.");
  if (scope === "isolated" && !hidden.length)
    throw Error(
      "Isolate triangles or hide a subset before using isolated ShrinkWrap scope.",
    );
  if (
    scope === "selected" &&
    (!selected ||
      selected.length !== count ||
      selected.some((value) => value !== 0 && value !== 1))
  )
    throw Error("Select visible triangles before local ShrinkWrap.");
  const selection =
    scope === "selected"
      ? new Uint8Array(selected!)
      : new Uint8Array(count).fill(1);
  for (const triangle of hidden) selection[triangle] = 0;
  if (!selection.some(Boolean))
    throw Error("The visible ShrinkWrap selection is empty.");
  return { ...operation, selection };
}
