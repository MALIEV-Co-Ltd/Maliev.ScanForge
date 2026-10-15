import type { Entity } from "./types";
import {
  cloudPlacement,
  cloudPoseBits,
  cloudPoseMatrix,
  composeCloudPose,
  placedCloud,
} from "./point-cloud-placement";
import { createDatumTransformExecutor } from "./datum-transform-pool";
import { datumScanTransformPlan } from "./datum-alignment";
export interface InteractiveBounds {
  min: readonly number[];
  max: readonly number[];
}
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const finite3 = (a: readonly number[]) =>
  a.length === 3 && a.every(Number.isFinite);

/** Shared transaction state: preview owns only Double poses; source geometry is immutable. */
export class InteractiveAlignmentSession {
  readonly id = crypto.randomUUID();
  readonly targetIds: readonly string[];
  private matrix = identity();
  private pivot: number[];
  private readonly originalPivot: number[];
  private readonly initialPoses: Map<string, number[]>;
  private poses: Map<string, number[]>;
  private version = 0;
  private applying = false;
  private boundsFresh = false;
  private measuredBounds?: InteractiveBounds[];
  private options = {
    strength: 100,
    mirror: false,
    mirrorPlane: 1 as 0 | 1 | 2,
  };
  constructor(
    readonly baseEntities: Entity[],
    ids: readonly string[],
    pivot: readonly number[],
  ) {
    if (
      !ids.length ||
      ids.length > 32 ||
      new Set(ids).size !== ids.length ||
      !finite3(pivot)
    )
      throw new Error(
        "Select one to 32 distinct scan targets and a finite pivot.",
      );
    this.targetIds = [...ids];
    this.pivot = [...pivot];
    this.originalPivot = [...pivot];
    this.initialPoses = new Map(
      ids.map((id) => {
        const e = baseEntities.find((e) => e.id === id);
        if (
          !e ||
          e.locked ||
          !e.visible ||
          e.selectable === false ||
          e.kernelId ||
          e.parametric ||
          !["mesh", "pointcloud"].includes(e.kind) ||
          !e.positions.length ||
          e.positions.length % (e.kind === "pointcloud" ? 3 : 9)
        )
          throw new Error(
            "Interactive alignment requires unlocked visible mesh or point-cloud targets.",
          );
        const placement = cloudPlacement(e);
        return [
          id,
          placement ? cloudPoseMatrix(placement.matrixBits) : identity(),
        ];
      }),
    );
    this.poses = new Map([...this.initialPoses].map(([id, p]) => [id, [...p]]));
  }
  validate(entities: Entity[]) {
    if (entities !== this.baseEntities)
      throw new Error(
        "The project changed during Interactive alignment; cancel and begin again.",
      );
  }
  private writable() {
    if (this.applying)
      throw new Error("Interactive alignment is publishing geometry.");
  }
  /** One synchronous publication may roll back without copying or baking source geometry. */
  checkpoint() {
    this.writable();
    const saved = {
      matrix: this.matrix,
      poses: this.poses,
      pivot: this.pivot,
      boundsFresh: this.boundsFresh,
      bounds: this.measuredBounds,
      options: this.options,
      version: this.version,
    };
    let used = false;
    return () => {
      if (used) return;
      this.writable();
      if (this.version !== saved.version && this.version !== saved.version + 1)
        throw new Error(
          "Cannot restore a stale Interactive publication checkpoint.",
        );
      used = true;
      this.matrix = saved.matrix;
      this.poses = saved.poses;
      this.pivot = saved.pivot;
      this.boundsFresh = saved.boundsFresh;
      this.measuredBounds = saved.bounds;
      this.options = saved.options;
      this.version = saved.version;
    };
  }
  advance(delta: readonly number[], bounds?: readonly InteractiveBounds[]) {
    this.writable();
    if (delta.length !== 12 || !delta.every(Number.isFinite))
      throw new Error("Interactive pose requires a finite 3x4 matrix.");
    const det =
      (delta[5] * delta[10] - delta[9] * delta[6]) * delta[0] -
      (delta[4] * delta[10] - delta[8] * delta[6]) * delta[1] +
      (delta[9] * delta[4] - delta[8] * delta[5]) * delta[2];
    if (!(Math.abs(Math.abs(det) - 1) < 0.001))
      throw new Error(
        "Interactive alignment accepts only the native rigid-transform determinant range.",
      );
    if (
      bounds &&
      (bounds.length !== this.targetIds.length ||
        bounds.some(
          (b) =>
            !finite3(b.min) ||
            !finite3(b.max) ||
            b.min.some((v, i) => v > b.max[i]),
        ))
    )
      throw new Error(
        "Interactive bounds must cover every target with finite ordered XYZ values.",
      );
    const poses = new Map(
      [...this.poses].map(([id, p]) => [id, composeCloudPose(delta, p)]),
    );
    const matrix = composeCloudPose(delta, this.matrix);
    const [x, y, z] = this.pivot;
    let pivot = [
      y * delta[1] + x * delta[0] + z * delta[2] + delta[3],
      x * delta[4] + y * delta[5] + z * delta[6] + delta[7],
      x * delta[8] + y * delta[9] + z * delta[10] + delta[11],
    ];
    if (bounds) {
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      for (const b of bounds)
        for (let a = 0; a < 3; a++) {
          if (b.min[a] <= min[a]) min[a] = Math.fround(b.min[a]);
          if (max[a] <= b.max[a]) max[a] = Math.fround(b.max[a]);
        }
      pivot = min.map((v, a) => Math.fround(Math.fround(max[a] + v) * 0.5));
    }
    if (!finite3(pivot)) throw new Error("Interactive pivot overflow.");
    this.poses = poses;
    this.matrix = matrix;
    this.pivot = pivot;
    this.boundsFresh = !!bounds;
    this.measuredBounds = bounds?.map((b) => ({
      min: [...b.min],
      max: [...b.max],
    }));
    this.version++;
  }
  configure(
    patch: Partial<{
      strength: number;
      mirror: boolean;
      mirrorPlane: 0 | 1 | 2;
    }>,
  ) {
    this.writable();
    if (
      patch.strength !== undefined &&
      (!Number.isInteger(patch.strength) ||
        patch.strength < 0 ||
        patch.strength > 100)
    )
      throw new Error("Drag strength must be an integer from zero to 100.");
    if (
      patch.mirrorPlane !== undefined &&
      ![0, 1, 2].includes(patch.mirrorPlane)
    )
      throw new Error("Mirror preview plane must be XY, YZ or XZ.");
    if (patch.mirror !== undefined && typeof patch.mirror !== "boolean")
      throw new Error("Mirror preview must be a boolean.");
    this.options = {
      strength: patch.strength ?? this.options.strength,
      mirror: patch.mirror ?? this.options.mirror,
      mirrorPlane: patch.mirrorPlane ?? this.options.mirrorPlane,
    };
    this.version++;
  }
  reset() {
    this.writable();
    this.matrix = identity();
    this.poses = new Map([...this.initialPoses].map(([id, p]) => [id, [...p]]));
    this.pivot = [...this.originalPivot];
    this.boundsFresh = false;
    this.measuredBounds = undefined;
    this.version++;
  }
  inspect() {
    return {
      sessionId: this.id,
      version: this.version,
      entityIds: [...this.targetIds],
      matrix: [...this.matrix],
      matrixBits: cloudPoseBits(this.matrix),
      pivot: [...this.pivot],
      boundsFresh: this.boundsFresh,
      ...(this.measuredBounds
        ? {
            bounds: this.measuredBounds.map((b) => ({
              min: [...b.min],
              max: [...b.max],
            })),
          }
        : {}),
      applying: this.applying,
      ...this.options,
      changed: [...this.poses].some(([id, p]) =>
        p.some((v, i) => v !== this.initialPoses.get(id)![i]),
      ),
      targets: [...this.poses].map(([entityId, matrix]) => ({
        entityId,
        matrix: [...matrix],
        poseBits: cloudPoseBits(matrix),
      })),
    };
  }
  async bake(
    options: {
      signal?: AbortSignal;
      parallel?: boolean;
      check?: () => void;
    } = {},
  ) {
    this.writable();
    if (!this.inspect().changed) return this.baseEntities;
    this.applying = true;
    const check = () => {
      options.signal?.throwIfAborted();
      options.check?.();
    };
    const executor = createDatumTransformExecutor({
      parallel: options.parallel,
      signal: options.signal,
    });
    try {
      const transformed = new Map<string, Entity>();
      for (const id of this.targetIds) {
        check();
        const entity = this.baseEntities.find((e) => e.id === id)!;
        const matrix = this.poses.get(id)!;
        if (entity.kind !== "pointcloud")
          transformed.set(
            id,
            (await executor.transformScan(entity, matrix)).entity,
          );
        else {
          const old = cloudPlacement(entity);
          const placement = {
            sourcePositions: old?.sourcePositions ?? entity.positions,
            sourceNormals: old?.sourceNormals ?? entity.normals,
            matrixBits: cloudPoseBits(matrix),
          };
          const positions = await executor.transform(
            placement.sourcePositions,
            matrix,
          );
          const normals = placement.sourceNormals
            ? await executor.transform(placement.sourceNormals, matrix, true)
            : undefined;
          const plan = datumScanTransformPlan(entity, matrix);
          const output = plan.assemble(
            positions.output,
            undefined,
            normals?.output,
          );
          transformed.set(
            id,
            placedCloud(output, placement, {
              positions: positions.output,
              normals: output.normals,
            }),
          );
        }
      }
      check();
      return this.baseEntities.map((e) => transformed.get(e.id) ?? e);
    } finally {
      executor.close();
      this.applying = false;
    }
  }
}
export type InteractiveAlignmentState = ReturnType<
  InteractiveAlignmentSession["inspect"]
>;
