import { noiseNormals } from "./scan-native-noise";
export interface NativeVertexState {
  flags: Uint32Array;
  ready: boolean;
  selected: number;
  hidden: number;
  visibleFaces: number;
}
/** Original 88AEB0 cache guard and ordered vertex/face walks. Yielding does not change arithmetic/order. */
export function* nativeVertexStateSteps(
  state: NativeVertexState,
  triangles: Uint32Array,
  faceFlags: Uint8Array,
): Generator<void, NativeVertexState> {
  if (state.ready) return state;
  if (
    !(state.flags instanceof Uint32Array) ||
    !(triangles instanceof Uint32Array) ||
    !(faceFlags instanceof Uint8Array) ||
    triangles.length % 3 ||
    faceFlags.length !== triangles.length / 3
  )
    throw new Error(
      "Native display state requires aligned triangle flags and indexed vertices.",
    );
  for (let i = 0; i < triangles.length; i++) {
    if (i % 4096 === 0) yield;
    if (triangles[i] >= state.flags.length)
      throw new Error("Native display triangle references a missing vertex.");
  }
  for (let i = 0; i < state.flags.length; i++) {
    if (i % 4096 === 0) yield;
    state.flags[i] = (state.flags[i] & 0xfffffffd) | 8;
  }
  state.selected = state.hidden = state.visibleFaces = 0;
  for (let i = 0; i < faceFlags.length; i++) {
    if (i % 4096 === 0) yield;
    if (faceFlags[i] & 2) {
      state.hidden = 1;
      continue;
    }
    state.visibleFaces++;
    for (let corner = 0; corner < 3; corner++)
      state.flags[triangles[i * 3 + corner]] &= 0xfffffff7;
    if (faceFlags[i] & 1) {
      state.selected = 1;
      for (let corner = 0; corner < 3; corner++)
        state.flags[triangles[i * 3 + corner]] |= 2;
    }
  }
  state.ready = true;
  return state;
}
export function refreshNativeVertexState(
  state: NativeVertexState,
  triangles: Uint32Array,
  faceFlags: Uint8Array,
): NativeVertexState {
  const steps = nativeVertexStateSteps(state, triangles, faceFlags);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
export interface InteractiveMeshSource {
  triangles?: Uint32Array;
  hidden?: Uint32Array;
  selection?: Uint8Array;
}
export interface InteractiveMeshDerivation extends InteractiveMeshSource {
  vertexCount: number;
  positions?: Float32Array;
  flags?: Uint32Array;
  deriveFlags: boolean;
  deriveNormals: boolean;
}
/** Shared worker/fallback preparation from application facet masks; no welding or topology rebuild. */
export function* interactiveMeshSourceSteps(
  input: InteractiveMeshDerivation,
): Generator<void, { state?: NativeVertexState; normals?: Float32Array }> {
  const count = (input.triangles?.length ?? input.vertexCount) / 3;
  if (
    !Number.isSafeInteger(input.vertexCount) ||
    input.vertexCount < 0 ||
    !Number.isInteger(count) ||
    (input.selection && input.selection.length !== count) ||
    (input.flags && input.flags.length !== input.vertexCount) ||
    (input.deriveNormals && input.positions?.length !== input.vertexCount * 3)
  )
    throw new Error(
      "Interactive source preparation requires aligned vertices, facets and masks.",
    );
  let triangles = input.triangles;
  if (!triangles) {
    triangles = new Uint32Array(input.vertexCount);
    for (let i = 0; i < triangles.length; i++) {
      if (i % 4096 === 0) yield;
      triangles[i] = i;
    }
  }
  let state: NativeVertexState | undefined;
  if (input.deriveFlags) {
    const faceFlags = new Uint8Array(count);
    if (input.selection)
      for (let i = 0; i < count; i++) {
        if (i % 4096 === 0) yield;
        if (input.selection[i]) faceFlags[i] = 1;
      }
    if (input.hidden)
      for (let i = 0; i < input.hidden.length; i++) {
        if (i % 4096 === 0) yield;
        const id = input.hidden[i];
        if (id >= count)
          throw new Error("Hidden facet is outside the Interactive source.");
        faceFlags[id] |= 2;
      }
    state = {
      flags: input.flags ?? new Uint32Array(input.vertexCount),
      ready: false,
      selected: 0,
      hidden: 0,
      visibleFaces: 0,
    };
    yield* nativeVertexStateSteps(state, triangles, faceFlags);
  }
  const normals = input.deriveNormals
    ? noiseNormals({ vertices: input.positions!, triangles })
    : undefined;
  return { state, normals };
}
export function deriveInteractiveMeshSource(input: InteractiveMeshDerivation) {
  const steps = interactiveMeshSourceSteps(input);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
