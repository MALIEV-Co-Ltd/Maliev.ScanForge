import {
  nativeGlobalPrepareScene,
  type NativeGlobalSceneScan,
} from "./scan-native-global-scene";
export interface GlobalSceneInput {
  scans: readonly NativeGlobalSceneScan[];
  spacing?: number;
  radius?: number;
  budget?: number;
  mask?: number;
  /** Replay environmental clock inputs; absent during normal application use. */
  clocks?: readonly (readonly number[])[];
}
export function executeGlobalScenePreparation(input: GlobalSceneInput) {
  const clocks: number[][] = input.scans.map(() => []);
  if (input.clocks && input.clocks.length !== input.scans.length)
    throw Error("Global scene clock streams must match the scan count.");
  const result = nativeGlobalPrepareScene(input.scans, {
    ...input,
    clock: (source) => {
      const clock = input.clocks
        ? input.clocks[source][clocks[source].length]
        : Math.trunc(performance.now());
      clocks[source].push(clock);
      return clock;
    },
  });
  if (input.clocks?.some((stream, i) => stream.length !== clocks[i].length))
    throw Error(
      "Global scene did not consume the complete replay clock streams.",
    );
  return {
    common: result.common.map((cell) => ({
      count: cell.points.length,
      normal: cell.normal,
      flags: cell.flags,
      color: cell.color,
    })),
    sources: result.sources.map((source, i) => ({
      id: source.scan.id,
      eligible: source.eligible,
      labels: source.geometry.labels,
      selected: result.selected[i],
      sampled: source.sampled,
      bounds: source.bounds,
      dimensions: source.grid.dimensions,
      size: source.grid.size,
      scale: source.grid.scale,
      origin: source.grid.origin,
      spatialFlags: source.grid.flags,
    })),
    clocks,
  };
}
export type GlobalSceneResult = ReturnType<
  typeof executeGlobalScenePreparation
>;
export type GlobalSceneResponse =
  { result: GlobalSceneResult } | { error: string };
