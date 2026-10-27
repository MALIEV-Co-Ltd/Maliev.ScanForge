import type { CadClient, CadPattern } from "./cad/client";
import type { KernelMesh, KernelPrimitive, Vec3 } from "./types";
import {
  validateSketch,
  solveSketch,
  sketchProfile,
  sketchCurveProfile,
  type Sketch,
} from "./sketch";
import { validatePatch, type NurbsPatch } from "./surfaces";
import { validateSketchFrame, type SketchFrame } from "./sketch-frame";

export interface FeatureRef {
  readonly featureId: string;
  readonly output?: number;
}
export type ParametricProfile =
  | {
      readonly kind: "sketch-curves";
      readonly sketch: Sketch;
    }
  | {
      readonly kind: "sketch";
      readonly sketch: Sketch;
      readonly chordTolerance?: number;
    }
  | {
      readonly kind: "polygon";
      readonly points: [number, number][];
      readonly frame?: SketchFrame;
    };
export type ParametricRecipe =
  | { readonly kind: "primitive"; readonly input: KernelPrimitive }
  | { readonly kind: "importBrep"; readonly brep: string }
  | { readonly kind: "sketchSurface"; readonly sketch: Sketch }
  | {
      readonly kind: "extrude";
      readonly profile: ParametricProfile;
      readonly height: number;
    }
  | {
      readonly kind: "revolve";
      readonly points: [number, number][];
      readonly angleDegrees: number;
    }
  | {
      readonly kind: "loft";
      readonly profiles: { points: [number, number][]; z: number }[];
      readonly ruled: boolean;
    }
  | {
      readonly kind: "sweep";
      readonly points: [number, number][];
      readonly path: Vec3[];
    }
  | { readonly kind: "surface"; readonly patch: NurbsPatch }
  | {
      readonly kind: "trimSurfaces";
      readonly source: FeatureRef;
      readonly cutters: FeatureRef[];
      readonly keepPoints: Vec3[];
      readonly toleranceMm?: number;
    }
  | {
      readonly kind: "closedShell";
      readonly patches: NurbsPatch[];
      readonly tolerance: number;
    }
  | {
      readonly kind: "pattern";
      readonly source: FeatureRef;
      readonly pattern: CadPattern;
    }
  | {
      readonly kind: "mirror";
      readonly source: FeatureRef;
      readonly planeOrigin: Vec3;
      readonly normal: Vec3;
    }
  | {
      readonly kind: "transform";
      readonly source: FeatureRef;
      readonly translation: Vec3;
      readonly rotation: Vec3;
      readonly scale: number;
    }
  | {
      readonly kind: "boolean";
      readonly operation: "union" | "subtract" | "intersect";
      readonly first: FeatureRef;
      readonly second: FeatureRef;
    }
  | {
      readonly kind: "split";
      readonly source: FeatureRef;
      readonly cutter: FeatureRef;
    }
  | {
      readonly kind: "edges";
      readonly source: FeatureRef;
      readonly edgeIndices: number[];
      readonly amount: number;
      readonly operation: "fillet" | "chamfer";
    }
  | {
      readonly kind: "offset";
      readonly source: FeatureRef;
      readonly distance: number;
    }
  | {
      readonly kind: "shell";
      readonly source: FeatureRef;
      readonly faceIndices: number[];
      readonly thickness: number;
    }
  | {
      readonly kind: "thicken";
      readonly source: FeatureRef;
      readonly thickness: number;
    }
  | {
      readonly kind: "sew";
      readonly sources: FeatureRef[];
      readonly tolerance: number;
    };
export interface ParametricFeature {
  readonly id: string;
  readonly name: string;
  readonly recipe: ParametricRecipe;
}
export interface ParametricModel {
  readonly format: "scanforge-parametric";
  readonly version: 1;
  readonly features: readonly ParametricFeature[];
}
export interface ParametricState {
  readonly model: ParametricModel;
  readonly results: Readonly<Record<string, readonly KernelMesh[]>>;
}
export interface ParametricEvaluator {
  /** Return newly owned native handles. A throwing evaluator must clean its own partially created outputs. */
  evaluate(
    feature: ParametricFeature,
    inputs: readonly KernelMesh[],
    signal?: AbortSignal,
  ): Promise<KernelMesh[]>;
  release(kernelIds: string[]): Promise<void>;
}
export interface CleanupFailure {
  readonly kernelIds: readonly string[];
  readonly message: string;
}
export interface RebuildResult extends ParametricState {
  readonly rebuiltFeatureIds: readonly string[];
  readonly releasedKernelIds: readonly string[];
  readonly cleanupFailures: readonly CleanupFailure[];
}
export interface RebuildOptions {
  signal?: AbortSignal;
  forceFeatureIds?: readonly string[];
  /** Explicit recipe submissions require admission even when identical to cached recipes. */
  admitFeatureIds?: readonly string[];
  preserveKernelIds?: ReadonlySet<string>;
}
export class ParametricRebuildError extends Error {
  readonly cleanupFailures: readonly CleanupFailure[];
  constructor(cause: unknown, cleanupFailures: readonly CleanupFailure[] = []) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "ParametricRebuildError";
    this.cleanupFailures = cleanupFailures;
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
function requireVector(value: unknown, label: string): asserts value is Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite))
    throw new Error(`${label} requires three finite coordinates.`);
}
function requirePositive(
  value: unknown,
  label: string,
): asserts value is number {
  if (!finite(value) || value <= 0)
    throw new Error(`${label} must be positive and finite.`);
}
function requireNonzero(
  value: unknown,
  label: string,
): asserts value is number {
  if (!finite(value) || Math.abs(value) < 1e-8)
    throw new Error(`${label} must be finite and nonzero.`);
}
function requirePolygon(value: unknown): asserts value is [number, number][] {
  if (
    !Array.isArray(value) ||
    value.length < 3 ||
    value.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(finite))
  )
    throw new Error("Profile requires at least three finite XY points.");
}
function requireIndices(value: unknown): asserts value is number[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.some((index) => !Number.isInteger(index) || index < 0)
  )
    throw new Error(
      "Topology indices must be nonempty nonnegative integer arrays.",
    );
}
function requireRef(value: unknown): asserts value is FeatureRef {
  if (
    !record(value) ||
    typeof value.featureId !== "string" ||
    !value.featureId ||
    (value.output !== undefined &&
      (!Number.isInteger(value.output) || Number(value.output) < 0))
  )
    throw new Error("Feature dependency reference is invalid.");
  if (Object.keys(value).some((key) => key !== "featureId" && key !== "output"))
    throw new Error("Feature dependency has unknown fields.");
}

export function featureDependencies(
  recipe: ParametricRecipe,
): readonly FeatureRef[] {
  if (recipe.kind === "boolean") return [recipe.first, recipe.second];
  if (recipe.kind === "split") return [recipe.source, recipe.cutter];
  if (recipe.kind === "trimSurfaces") return [recipe.source, ...recipe.cutters];
  if (recipe.kind === "sew") return recipe.sources;
  return "source" in recipe ? [recipe.source] : [];
}

/** Bound CAD consumers before detailed validation or the synchronous dense solver. */
function admitCadSketchSolve(input: unknown) {
  if (!record(input)) return;
  const points = Array.isArray(input.points) ? input.points : [],
    constraints = Array.isArray(input.constraints) ? input.constraints : [],
    segments = Array.isArray(input.segments) ? input.segments : [],
    arcs = Array.isArray(input.arcs) ? input.arcs : [];
  const limit = (actual: number, maximum: number, label: string) => {
    if (actual > maximum)
      throw new Error(
        `CAD sketch solver ${label} limit exceeded: ${actual} > ${maximum}.`,
      );
  };
  limit(points.length, 128, "authored point count");
  limit(constraints.length, 256, "constraint count");
  limit(segments.length + arcs.length, 10000, "stored curve count");
  const arcIds = new Set(arcs.filter(record).map((arc) => arc.id));
  const residuals = constraints.reduce<number>((count, constraint) => {
    if (!record(constraint)) return count + 1;
    if (["fixed", "coincident", "collinear"].includes(String(constraint.kind)))
      return count + 2;
    if (constraint.kind === "symmetric")
      return count + (arcIds.has(constraint.first) ? 6 : 4);
    return count + 1;
  }, arcs.length);
  const variables = 2 * points.length,
    denseCells = variables * variables;
  limit(residuals, 512, "residual row count");
  limit(denseCells, 65536, "dense matrix cell count");
  // Final finite differences run even without residuals; only nonempty rows can iterate.
  const finalWork =
      denseCells * residuals + 4 * variables * residuals + denseCells,
    iterativeWork = residuals
      ? 100 *
        (2 * variables ** 3 +
          denseCells * residuals +
          4 * variables * residuals)
      : 0;
  limit(iterativeWork + finalWork, 250000000, "estimated work budget");
}

function validateRecipe(value: unknown): asserts value is ParametricRecipe {
  if (!record(value) || typeof value.kind !== "string")
    throw new Error("Feature recipe is invalid.");
  const fields: Record<string, string[]> = {
    primitive: ["input"],
    importBrep: ["brep"],
    sketchSurface: ["sketch"],
    extrude: ["profile", "height"],
    revolve: ["points", "angleDegrees"],
    loft: ["profiles", "ruled"],
    sweep: ["points", "path"],
    surface: ["patch"],
    trimSurfaces: ["source", "cutters", "keepPoints", "toleranceMm"],
    closedShell: ["patches", "tolerance"],
    pattern: ["source", "pattern"],
    mirror: ["source", "planeOrigin", "normal"],
    transform: ["source", "translation", "rotation", "scale"],
    boolean: ["operation", "first", "second"],
    split: ["source", "cutter"],
    edges: ["source", "edgeIndices", "amount", "operation"],
    offset: ["source", "distance"],
    shell: ["source", "faceIndices", "thickness"],
    thicken: ["source", "thickness"],
    sew: ["sources", "tolerance"],
  };
  if (!Object.hasOwn(fields, value.kind))
    throw new Error("Unsupported parametric feature kind.");
  const allowed = fields[value.kind];
  if (
    Object.keys(value).some((key) => key !== "kind" && !allowed.includes(key))
  )
    throw new Error("Feature recipe has unknown fields.");
  switch (value.kind) {
    case "primitive": {
      const p = value.input;
      if (!record(p)) throw new Error("Primitive input is missing.");
      requireVector(p.center, "Primitive center");
      if (p.kind === "box") {
        requireVector(p.size, "Box size");
        if ((p.size as number[]).some((size) => size <= 0))
          throw new Error("Box size must be positive.");
      } else if (p.kind === "sphere")
        requirePositive(p.radius, "Sphere radius");
      else if (p.kind === "cylinder" || p.kind === "cone") {
        requireVector(p.axis, "Primitive axis");
        if (Math.hypot(...(p.axis as number[])) < 1e-8)
          throw new Error("Primitive axis must be nonzero.");
        requirePositive(p.radius, "Base radius");
        requirePositive(p.height, "Primitive height");
        if (p.kind === "cone" && (!finite(p.topRadius) || p.topRadius < 0))
          throw new Error("Top radius must be nonnegative.");
      } else throw new Error("Unsupported primitive kind.");
      break;
    }
    case "importBrep":
      if (typeof value.brep !== "string" || !value.brep.trim())
        throw new Error("Static BREP source is empty.");
      break;
    case "sketchSurface":
      validateSketch(value.sketch);
      break;
    case "extrude": {
      const p = value.profile;
      if (!record(p)) throw new Error("Extrusion profile is missing.");
      if (p.kind === "polygon") {
        requirePolygon(p.points);
        if (p.frame !== undefined) validateSketchFrame(p.frame);
      } else if (p.kind === "sketch") {
        validateSketch(p.sketch);
        if (p.chordTolerance !== undefined)
          requirePositive(p.chordTolerance, "Arc chord tolerance");
      } else if (p.kind === "sketch-curves") {
        if (Object.keys(p).some((key) => key !== "kind" && key !== "sketch"))
          throw new Error("Analytic sketch profile has unknown fields.");
        validateSketch(p.sketch);
      } else throw new Error("Unsupported profile kind.");
      requirePositive(value.height, "Extrusion height");
      break;
    }
    case "revolve":
      requirePolygon(value.points);
      requirePositive(value.angleDegrees, "Revolve angle");
      if (value.angleDegrees > 360)
        throw new Error("Revolve angle exceeds 360 degrees.");
      break;
    case "loft":
      if (
        !Array.isArray(value.profiles) ||
        value.profiles.length < 2 ||
        typeof value.ruled !== "boolean"
      )
        throw new Error(
          "Loft requires at least two sections and a ruled flag.",
        );
      for (const p of value.profiles) {
        if (!record(p) || !finite(p.z))
          throw new Error("Loft section height is invalid.");
        requirePolygon(p.points);
      }
      break;
    case "sweep":
      requirePolygon(value.points);
      if (!Array.isArray(value.path) || value.path.length < 2)
        throw new Error("Sweep requires at least two spine points.");
      value.path.forEach((p) => requireVector(p, "Spine point"));
      break;
    case "surface":
      validatePatch(value.patch as NurbsPatch);
      break;
    case "trimSurfaces": {
      requireRef(value.source);
      if (
        !Array.isArray(value.cutters) ||
        !value.cutters.length ||
        value.cutters.length > 16
      )
        throw new Error("Surface trim requires 1 to 16 cutter references.");
      value.cutters.forEach(requireRef);
      const key = (ref: FeatureRef) => `${ref.featureId}:${ref.output ?? 0}`;
      const refs = [value.source, ...value.cutters] as FeatureRef[];
      if (new Set(refs.map(key)).size !== refs.length)
        throw new Error("Surface trim source and cutters must be distinct.");
      if (
        !Array.isArray(value.keepPoints) ||
        !value.keepPoints.length ||
        value.keepPoints.length > 128
      )
        throw new Error("Surface trim requires 1 to 128 retained points.");
      for (const point of value.keepPoints) {
        requireVector(point, "Retained point");
        if (point.some((n) => Math.abs(n) > 1e9))
          throw new Error("Retained point exceeds world coordinate limits.");
      }
      if (value.toleranceMm !== undefined) {
        requirePositive(value.toleranceMm, "Surface trim tolerance");
        if (value.toleranceMm > 1e6)
          throw new Error(
            "Surface trim tolerance exceeds one million millimetres.",
          );
      }
      break;
    }
    case "closedShell":
      if (!Array.isArray(value.patches) || value.patches.length < 2)
        throw new Error("Closed shell requires at least two patches.");
      value.patches.forEach((patch) => validatePatch(patch as NurbsPatch));
      requirePositive(value.tolerance, "Shell sewing tolerance");
      break;
    case "pattern": {
      requireRef(value.source);
      const p = value.pattern;
      if (
        !record(p) ||
        !Number.isInteger(p.count) ||
        Number(p.count) < 2 ||
        Number(p.count) > 256
      )
        throw new Error("Pattern count must be an integer from 2 to 256.");
      if (p.kind === "linear") {
        requireVector(p.step, "Pattern spacing");
        if (Math.hypot(...(p.step as number[])) < 1e-8)
          throw new Error("Pattern spacing must be nonzero.");
      } else if (p.kind === "circular") {
        requireVector(p.center, "Pattern center");
        requireVector(p.axis, "Pattern axis");
        if (Math.hypot(...(p.axis as number[])) < 1e-8)
          throw new Error("Pattern axis must be nonzero.");
        requireNonzero(p.angleDegrees, "Pattern angle");
        if (
          Math.abs(p.angleDegrees) > 360 ||
          Math.abs(p.angleDegrees % 360) < 1e-8
        )
          throw new Error(
            "Pattern angle must define a nonidentity increment within 360 degrees.",
          );
      } else throw new Error("Unsupported pattern kind.");
      break;
    }
    case "mirror":
      requireRef(value.source);
      requireVector(value.planeOrigin, "Mirror origin");
      requireVector(value.normal, "Mirror normal");
      if (Math.hypot(...(value.normal as number[])) < 1e-8)
        throw new Error("Mirror normal must be nonzero.");
      break;
    case "transform":
      requireRef(value.source);
      requireVector(value.translation, "Translation");
      requireVector(value.rotation, "Rotation");
      requirePositive(value.scale, "Scale");
      break;
    case "boolean":
      requireRef(value.first);
      requireRef(value.second);
      if (!["union", "subtract", "intersect"].includes(String(value.operation)))
        throw new Error("Unsupported boolean operation.");
      break;
    case "split":
      requireRef(value.source);
      requireRef(value.cutter);
      break;
    case "edges":
      requireRef(value.source);
      requireIndices(value.edgeIndices);
      requirePositive(value.amount, "Edge treatment amount");
      if (!["fillet", "chamfer"].includes(String(value.operation)))
        throw new Error("Unsupported edge treatment.");
      break;
    case "offset":
      requireRef(value.source);
      requireNonzero(value.distance, "Offset distance");
      break;
    case "shell":
      requireRef(value.source);
      requireIndices(value.faceIndices);
      requireNonzero(value.thickness, "Wall thickness");
      break;
    case "thicken":
      requireRef(value.source);
      requireNonzero(value.thickness, "Wall thickness");
      break;
    case "sew":
      if (!Array.isArray(value.sources) || !value.sources.length)
        throw new Error("Sew requires source features.");
      value.sources.forEach(requireRef);
      requirePositive(value.tolerance, "Sew tolerance");
      break;
    default:
      throw new Error("Unsupported parametric feature kind.");
  }
}

export function validateParametricModel(
  input: unknown,
  options: { admitFeatureIds?: readonly string[] } = {},
): asserts input is ParametricModel {
  if (
    !record(input) ||
    input.format !== "scanforge-parametric" ||
    input.version !== 1 ||
    !Array.isArray(input.features)
  )
    throw new Error("Unsupported parametric model structure.");
  // Stored recipes stay structurally readable; admit only execution/submission candidates.
  const admitted = new Set(options.admitFeatureIds);
  for (const feature of input.features) {
    if (
      !record(feature) ||
      typeof feature.id !== "string" ||
      !admitted.has(feature.id)
    )
      continue;
    const recipe = feature.recipe;
    if (!record(recipe)) continue;
    if (recipe.kind === "sketchSurface") admitCadSketchSolve(recipe.sketch);
    else if (
      recipe.kind === "extrude" &&
      record(recipe.profile) &&
      (recipe.profile.kind === "sketch" ||
        recipe.profile.kind === "sketch-curves")
    )
      admitCadSketchSolve(recipe.profile.sketch);
  }
  const features = new Map<string, ParametricFeature>();
  for (const value of input.features) {
    if (
      !record(value) ||
      typeof value.id !== "string" ||
      !value.id ||
      typeof value.name !== "string" ||
      features.has(value.id)
    )
      throw new Error("Features require unique stable IDs and names.");
    validateRecipe(value.recipe);
    features.set(value.id, value as unknown as ParametricFeature);
  }
  for (const feature of features.values())
    for (const ref of featureDependencies(feature.recipe)) {
      const dependency = features.get(ref.featureId);
      if (!dependency)
        throw new Error(`Missing feature dependency ${ref.featureId}.`);
      const output = ref.output ?? 0;
      if (output >= (dependency.recipe.kind === "split" ? 2 : 1))
        throw new Error(
          `Feature output ${ref.featureId}:${output} does not exist.`,
        );
    }
  topologicalFeatures(input as unknown as ParametricModel);
}

/** Stable iterative topological ordering; handles forward references without recursive stack growth. */
export function topologicalFeatures(
  model: ParametricModel,
): ParametricFeature[] {
  const byId = new Map(model.features.map((feature) => [feature.id, feature]));
  const children = new Map(
    model.features.map((feature) => [feature.id, [] as string[]]),
  );
  const incoming = new Map(
    model.features.map((feature) => [
      feature.id,
      new Set(featureDependencies(feature.recipe).map((ref) => ref.featureId))
        .size,
    ]),
  );
  for (const feature of model.features)
    for (const id of new Set(
      featureDependencies(feature.recipe).map((ref) => ref.featureId),
    )) {
      if (!byId.has(id)) throw new Error(`Missing feature dependency ${id}.`);
      children.get(id)!.push(feature.id);
    }
  const queue = model.features
      .filter((feature) => incoming.get(feature.id) === 0)
      .map((feature) => feature.id),
    ordered: ParametricFeature[] = [];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    ordered.push(byId.get(id)!);
    for (const child of children.get(id)!) {
      const count = incoming.get(child)! - 1;
      incoming.set(child, count);
      if (!count) queue.push(child);
    }
  }
  if (ordered.length !== model.features.length)
    throw new Error("Parametric feature graph contains a dependency cycle.");
  return ordered;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function freezeTree<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    Object.freeze(value);
    for (const item of Object.values(value)) freezeTree(item, seen);
  }
  return value;
}
function abort(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException("Parametric rebuild cancelled.", "AbortError");
}
const handles = (results: Readonly<Record<string, readonly KernelMesh[]>>) =>
  new Set(
    Object.values(results).flatMap((outputs) =>
      outputs.map((output) => output.kernelId),
    ),
  );

function hasCachedOutputs(recipe: unknown, outputs?: readonly KernelMesh[]) {
  const count = record(recipe) && recipe.kind === "split" ? 2 : 1;
  return (
    outputs?.length === count &&
    Array.from({ length: count }, (_, index) => outputs?.[index]).every(
      (output) =>
        output && typeof output.kernelId === "string" && !!output.kernelId,
    )
  );
}

/** Evaluate affected descendants privately. Cancellation waits for an in-flight evaluator so new handles can be released. */
export async function rebuildParametric(
  previous: ParametricState | undefined,
  next: ParametricModel,
  evaluator: ParametricEvaluator,
  options: RebuildOptions = {},
): Promise<RebuildResult> {
  const previousFeatures = Array.isArray(previous?.model?.features)
    ? previous.model.features
    : [];
  const oldFeatures = new Map(
    previousFeatures
      .filter((feature) => feature && typeof feature.id === "string")
      .map((feature) => [feature.id, feature]),
  );
  const admissionIds = new Set([
    ...(options.forceFeatureIds ?? []),
    ...(options.admitFeatureIds ?? []),
  ]);
  if (record(next) && Array.isArray(next.features))
    for (const feature of next.features) {
      if (!record(feature) || typeof feature.id !== "string") continue;
      const old = oldFeatures.get(feature.id);
      if (
        !old ||
        !hasCachedOutputs(feature.recipe, previous?.results[feature.id]) ||
        canonical(old.recipe) !== canonical(feature.recipe)
      )
        admissionIds.add(feature.id);
    }
  validateParametricModel(next, { admitFeatureIds: [...admissionIds] });
  if (previous) validateParametricModel(previous.model);
  abort(options.signal);
  const model = freezeTree(structuredClone(next)),
    ordered = topologicalFeatures(model);
  const dirty = new Set(options.forceFeatureIds ?? []);
  for (const id of dirty)
    if (!ordered.some((feature) => feature.id === id))
      throw new Error(`Forced rebuild feature ${id} is missing.`);
  const results: Record<string, readonly KernelMesh[]> = Object.create(null),
    oldHandles = handles(previous?.results ?? {}),
    created = new Set<string>(),
    rebuilt: string[] = [];
  for (const feature of ordered) {
    const old = oldFeatures.get(feature.id),
      cached = previous?.results[feature.id];
    if (
      !old ||
      !hasCachedOutputs(feature.recipe, cached) ||
      canonical(old.recipe) !== canonical(feature.recipe) ||
      featureDependencies(feature.recipe).some((ref) =>
        dirty.has(ref.featureId),
      )
    )
      dirty.add(feature.id);
  }
  async function release(ids: string[]): Promise<CleanupFailure[]> {
    if (!ids.length) return [];
    try {
      await evaluator.release(ids);
      return [];
    } catch (error) {
      return [
        {
          kernelIds: ids,
          message: error instanceof Error ? error.message : String(error),
        },
      ];
    }
  }
  try {
    for (const feature of ordered) {
      abort(options.signal);
      if (!dirty.has(feature.id)) {
        results[feature.id] = previous!.results[feature.id];
        continue;
      }
      const inputs = featureDependencies(feature.recipe).map((ref) => {
        const output = results[ref.featureId]?.[ref.output ?? 0];
        if (!output)
          throw new Error(
            `Dependency ${ref.featureId}:${ref.output ?? 0} has no evaluated output.`,
          );
        return output;
      });
      const outputs = await evaluator.evaluate(
        feature,
        Object.freeze(inputs),
        options.signal,
      );
      if (Array.isArray(outputs))
        for (const output of outputs)
          if (
            output &&
            typeof output.kernelId === "string" &&
            !oldHandles.has(output.kernelId)
          )
            created.add(output.kernelId);
      abort(options.signal);
      if (
        !Array.isArray(outputs) ||
        outputs.length !== (feature.recipe.kind === "split" ? 2 : 1) ||
        outputs.some(
          (output) =>
            !output ||
            typeof output.kernelId !== "string" ||
            !output.kernelId ||
            !Array.isArray(output.positions) ||
            !output.positions.length ||
            output.positions.length % 9 !== 0 ||
            output.positions.some((value) => !Number.isFinite(value)),
        )
      )
        throw new Error(
          `Feature ${feature.id} returned invalid native outputs.`,
        );
      if (
        outputs.some((output) => oldHandles.has(output.kernelId)) ||
        new Set(outputs.map((output) => output.kernelId)).size !==
          outputs.length ||
        Object.values(results).some((existing) =>
          existing.some((output) =>
            outputs.some((next) => next.kernelId === output.kernelId),
          ),
        )
      )
        throw new Error(
          `Feature ${feature.id} must return newly owned distinct native handles.`,
        );
      results[feature.id] = Object.freeze(
        outputs.map((output) => Object.freeze({ ...output })),
      );
      rebuilt.push(feature.id);
    }
    abort(options.signal);
  } catch (error) {
    const failures = await release([...created]);
    throw new ParametricRebuildError(error, failures);
  }
  const retained = handles(results),
    invalidated = [...oldHandles].filter(
      (id) => !retained.has(id) && !options.preserveKernelIds?.has(id),
    );
  const cleanupFailures = await release(invalidated);
  return Object.freeze({
    model,
    results: Object.freeze(results),
    rebuiltFeatureIds: Object.freeze(rebuilt),
    releasedKernelIds: Object.freeze(cleanupFailures.length ? [] : invalidated),
    cleanupFailures: Object.freeze(cleanupFailures),
  });
}

/** Native CAD consumer adapter. Failed kernel requests already clean partially constructed native results. */
export function createCadEvaluator(client: CadClient): ParametricEvaluator {
  return {
    release: (ids) => client.release(ids),
    async evaluate(feature, inputs, signal) {
      abort(signal);
      const r = feature.recipe,
        first = inputs[0]?.kernelId,
        second = inputs[1]?.kernelId;
      let output: KernelMesh;
      switch (r.kind) {
        case "primitive":
          output = await client.primitive(r.input);
          break;
        case "importBrep":
          output = await client.importFile(
            new TextEncoder().encode(r.brep),
            "brep",
          );
          break;
        case "sketchSurface": {
          admitCadSketchSolve(r.sketch);
          const solution = solveSketch(r.sketch);
          if (!solution.converged)
            throw new Error(
              `Sketch conflicts: ${solution.conflictingConstraintIds.join(", ")}`,
            );
          output = await client.sketchSurface(
            sketchCurveProfile(solution.sketch),
            solution.sketch.frame,
          );
          break;
        }
        case "extrude": {
          if (r.profile.kind === "sketch-curves") {
            admitCadSketchSolve(r.profile.sketch);
            const solution = solveSketch(r.profile.sketch);
            if (!solution.converged)
              throw new Error(
                `Sketch conflicts: ${solution.conflictingConstraintIds.join(", ")}`,
              );
            output = await client.extrudeCurves(
              sketchCurveProfile(solution.sketch),
              r.height,
              solution.sketch.frame,
            );
            break;
          }
          let points: [number, number][];
          if (r.profile.kind === "polygon") points = r.profile.points;
          else {
            admitCadSketchSolve(r.profile.sketch);
            const solution = solveSketch(r.profile.sketch);
            if (!solution.converged)
              throw new Error(
                `Sketch conflicts: ${solution.conflictingConstraintIds.join(", ")}`,
              );
            points = sketchProfile(solution.sketch, r.profile.chordTolerance);
          }
          const frame =
            r.profile.kind === "polygon"
              ? r.profile.frame
              : r.profile.sketch.frame;
          output = await client.extrude(points, r.height, frame);
          break;
        }
        case "revolve":
          output = await client.revolve(r.points, r.angleDegrees);
          break;
        case "loft":
          output = await client.loft(r.profiles, r.ruled);
          break;
        case "sweep":
          output = await client.sweep(r.points, r.path);
          break;
        case "surface":
          output = await client.surface(r.patch);
          break;
        case "trimSurfaces":
          output = await client.trimSurfaces(
            first,
            inputs.slice(1).map((input) => input.kernelId),
            r.keepPoints,
            r.toleranceMm,
          );
          break;
        case "closedShell":
          output = await client.closedShell(r.patches, r.tolerance);
          break;
        case "pattern":
          output = await client.pattern(first, r.pattern);
          break;
        case "mirror":
          output = await client.mirror(first, r.planeOrigin, r.normal);
          break;
        case "transform":
          output = await client.transform(
            first,
            r.translation,
            r.rotation,
            r.scale,
          );
          break;
        case "boolean":
          output = await client.boolean(r.operation, first, second);
          break;
        case "split":
          return client.split(first, second);
        case "edges":
          output = await client.edgeTreatment(
            first,
            r.edgeIndices,
            r.amount,
            r.operation,
          );
          break;
        case "offset":
          output = await client.offset(first, r.distance);
          break;
        case "shell":
          output = await client.shell(first, r.faceIndices, r.thickness);
          break;
        case "thicken":
          output = await client.thicken(first, r.thickness);
          break;
        case "sew":
          output = await client.sew(
            inputs.map((input) => input.kernelId),
            r.tolerance,
          );
          break;
      }
      return [output];
    },
  };
}
