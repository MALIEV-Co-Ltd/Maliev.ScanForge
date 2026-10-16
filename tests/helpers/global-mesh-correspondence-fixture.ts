import type {
  GlobalQueryJob,
  GlobalQueryWorkerInit,
} from "../../src/scan-global-query-worker";
interface Mesh {
  vertices: number[];
  triangles: number[];
  flags?: number[];
  filterHidden?: boolean;
}
interface Case {
  source: number[][];
  targets: number[][][];
  targetMeshes: Mesh[][];
  sourceLabelWords: number[];
  targetLabelWords: number[][];
  radius: number;
  mode: string;
  cells?: number[][];
  normals?: number[][];
  targetNormals?: number[][][];
  flags?: number[];
  targetFlags?: number[][];
  sourcePose?: number[];
  targetPoses?: number[][];
  mask?: number;
  gateCount?: number;
}
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
export function meshCorrespondenceFixture(c: Case) {
  const geometry = (
    points: number[][],
    normals: number[][] | undefined,
    labels: number[],
    flags?: number[],
  ) => ({
    points: Float32Array.from(points.flat()),
    normals: Float32Array.from((normals ?? points.map(() => [0, 0, 1])).flat()),
    labels: Uint32Array.from(labels),
    flags: flags ? Uint32Array.from(flags) : undefined,
  });
  const scans: GlobalQueryWorkerInit["scans"] = [
    {
      id: "source",
      geometry: geometry(c.source, c.normals, c.sourceLabelWords, c.flags),
    },
    ...c.targets.map((p, i) => ({
      id: `target-${i}`,
      geometry: {
        ...geometry(
          p,
          c.targetNormals?.[i],
          c.targetLabelWords[i],
          c.targetFlags?.[i],
        ),
        targetMeshes: c.targetMeshes[i].map((m) => ({
          ...m,
          vertices: Float32Array.from(m.vertices),
          triangles: Uint32Array.from(m.triangles),
          flags: m.flags ? Uint8Array.from(m.flags) : undefined,
        })),
      },
    })),
  ];
  const job: GlobalQueryJob = {
    sourceId: "source",
    poses: scans.map((s, i) => ({
      id: s.id,
      matrix:
        i === 0
          ? (c.sourcePose ?? identity)
          : (c.targetPoses?.[i - 1] ?? identity),
    })),
    cells: c.cells ?? [c.source.map((_, i) => i)],
    radius: c.radius,
    mode: c.mode as GlobalQueryJob["mode"],
    mask: c.mask,
    gateCount: c.gateCount,
  };
  return { scans, job };
}
