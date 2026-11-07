import { validateSketch } from "./sketch";
import { validateSavedSketchDisplay } from "./saved-sketch-display";
import { validateSpatialCurves } from "./spatial-sketch";
import type { Project, SavedSketch } from "./types";

type Authoring = NonNullable<Project["authoring"]>;
/** Target state of one transaction-owned saved sketch; absent value removes it. */
export interface ModelSketchChange {
  id: string;
  value?: SavedSketch;
  index?: number;
}

export function validateModelSketchChanges(
  input: unknown,
): asserts input is ModelSketchChange[] {
  if (!Array.isArray(input) || input.length > 100000)
    throw Error("Invalid model sketch history.");
  const ids = new Set<string>();
  for (const item of input) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).some(
        (key) => !["id", "value", "index"].includes(key),
      ) ||
      typeof item.id !== "string" ||
      !item.id.length ||
      item.id.length > 200 ||
      ids.has(item.id)
    )
      throw Error("Invalid model sketch history identity.");
    ids.add(item.id);
    if (item.value === undefined) {
      if (item.index !== undefined)
        throw Error("Invalid removed model sketch index.");
      continue;
    }
    const value = item.value;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (key) =>
          !["id", "name", "kind", "sketch", "curves", "visible"].includes(key),
      ) ||
      value.id !== item.id ||
      typeof value.name !== "string" ||
      value.name.length > 200 ||
      (value.visible !== undefined && typeof value.visible !== "boolean") ||
      !Number.isSafeInteger(item.index) ||
      item.index < 0 ||
      item.index > 100000
    )
      throw Error("Invalid saved model sketch target.");
    if (value.kind === "spatial") {
      if ("sketch" in value)
        throw Error("Spatial sketch cannot contain planar data.");
      validateSpatialCurves(value.curves);
    } else {
      if (
        (value.kind !== undefined && value.kind !== "planar") ||
        "curves" in value
      )
        throw Error("Invalid planar sketch variant.");
      validateSketch(value.sketch);
    }
    if (value.visible) validateSavedSketchDisplay(value);
  }
}

/** Read live owned values when traversing history, retaining edits for the reverse step. */
export function captureModelSketchChanges(
  authoring: Authoring,
  changes: readonly ModelSketchChange[],
): ModelSketchChange[] {
  validateModelSketchChanges(changes);
  return changes.map(({ id }) => {
    const index = authoring.sketches?.findIndex((row) => row.id === id) ?? -1;
    return index < 0
      ? { id }
      : { id, index, value: structuredClone(authoring.sketches![index]) };
  });
}

/** Merge only owned identities; model history must never restore all authoring state. */
export function applyModelSketchChanges(
  authoring: Authoring,
  changes: readonly ModelSketchChange[],
): Authoring {
  validateModelSketchChanges(changes);
  const ids = new Set(changes.map((row) => row.id));
  const sketches = (authoring.sketches ?? []).filter((row) => !ids.has(row.id));
  for (const row of [...changes].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  ))
    if (row.value)
      sketches.splice(
        Math.min(row.index!, sketches.length),
        0,
        structuredClone(row.value),
      );
  const next = { ...authoring, sketches };
  if (
    next.activeSketchId &&
    !sketches.some((row) => row.id === next.activeSketchId)
  )
    delete next.activeSketchId;
  return next;
}

/** Trusted publication is additive; ordinary authoring commands own existing sketches. */
export function prepareModelSketchPublication(
  authoring: Authoring,
  additions: readonly SavedSketch[],
) {
  const changes = additions.map((value, i) => ({
    id: value.id,
    value,
    index: (authoring.sketches?.length ?? 0) + i,
  }));
  validateModelSketchChanges(changes);
  if (
    additions.some((value) =>
      authoring.sketches?.some((row) => row.id === value.id),
    )
  )
    throw Error(
      "Model sketch publication requires a new saved sketch identity.",
    );
  return {
    authoring: applyModelSketchChanges(authoring, changes),
    changes: additions.map(({ id }) => ({ id })),
  };
}
