export interface GuideRefreshState {
  /** Stored native byte; nonzero means the one-time gate has been consumed. */
  refreshed: number;
}

/** Recovered one-time dispatch; mapping itself is a separate dependency. */
export function refreshCurvatureGuide(
  state: GuideRefreshState,
  mode: number,
  map: (options: {
    optionWord: number;
    scalar: number;
    optionByte: number;
  }) => void,
): boolean {
  if (
    !Number.isInteger(state.refreshed) ||
    state.refreshed < 0 ||
    state.refreshed > 255 ||
    !Number.isInteger(mode) ||
    mode < -2147483648 ||
    mode > 2147483647
  )
    throw new Error("Guide refresh state or mode is invalid.");
  if (state.refreshed !== 0) return false;
  state.refreshed = 1;
  if (mode !== 0) return false;
  map({ optionWord: 1, scalar: 0, optionByte: 1 });
  return true;
}
