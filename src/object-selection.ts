/** Object selection shared by the tree, viewport, and application operations. */
export interface ObjectSelectionState {
  ids: string[];
  activeId: string | null;
  anchorId: string | null;
}

export interface ObjectSelectionModifiers {
  toggle?: boolean;
  range?: boolean;
}

/** Remove unavailable objects while keeping a valid active object and range anchor. */
export function reconcileObjectSelection(
  state: ObjectSelectionState,
  orderedPickableIds: readonly string[],
): ObjectSelectionState {
  const selected = new Set(state.ids);
  const ids = [...new Set(orderedPickableIds)].filter((id) => selected.has(id));
  return {
    ids,
    activeId:
      state.activeId !== null && ids.includes(state.activeId)
        ? state.activeId
        : (ids.at(-1) ?? null),
    anchorId:
      state.anchorId !== null && orderedPickableIds.includes(state.anchorId)
        ? state.anchorId
        : null,
  };
}

/**
 * Apply object click semantics in tree order. Supply only selectable, unlocked
 * objects; hidden tree rows can remain pickable. Range clicks preserve their
 * anchor, and toggle+range adds the range to the existing selection.
 */
export function selectObject(
  state: ObjectSelectionState,
  orderedPickableIds: readonly string[],
  clickedId: string,
  modifiers: ObjectSelectionModifiers = {},
): ObjectSelectionState {
  const order = [...new Set(orderedPickableIds)];
  const current = reconcileObjectSelection(state, order);
  const clickedIndex = order.indexOf(clickedId);
  if (clickedIndex === -1) return current;

  if (modifiers.range) {
    const anchorId = current.anchorId ?? clickedId;
    const anchorIndex = order.indexOf(anchorId);
    const range = order.slice(
      Math.min(anchorIndex, clickedIndex),
      Math.max(anchorIndex, clickedIndex) + 1,
    );
    const selected = new Set(modifiers.toggle ? current.ids : []);
    for (const id of range) selected.add(id);
    return {
      ids: order.filter((id) => selected.has(id)),
      activeId: clickedId,
      anchorId,
    };
  }

  if (modifiers.toggle) {
    const selected = new Set(current.ids);
    const removing = selected.has(clickedId);
    if (removing) selected.delete(clickedId);
    else selected.add(clickedId);
    const ids = order.filter((id) => selected.has(id));
    return {
      ids,
      activeId: removing
        ? current.activeId !== null && selected.has(current.activeId)
          ? current.activeId
          : (ids.at(-1) ?? null)
        : clickedId,
      anchorId: clickedId,
    };
  }

  return { ids: [clickedId], activeId: clickedId, anchorId: clickedId };
}
