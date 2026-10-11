/** Companion index ordering, including its nonzero three-way callback semantics. */
export function orderAxisVertices(
  positions: Float32Array,
  axis: 0 | 1 | 2,
): Uint32Array {
  if (positions.length % 3 || ![0, 1, 2].includes(axis))
    throw new Error("Vertex ordering dimensions or axis are invalid.");
  for (const value of positions)
    if (!Number.isFinite(value))
      throw new Error("Vertex ordering coordinates must be finite.");
  const count = positions.length / 3;
  if (count > 0x7fffffff)
    throw new Error("Vertex ordering exceeds signed index capacity.");
  const order = Uint32Array.from({ length: count }, (_, index) => index);
  // The recovered scalar callback returns -1/0/1; the helper tests nonzero.
  // Consequently this predicate must not be replaced by a less-than comparator.
  const different = (a: number, b: number) =>
    positions[a * 3 + axis] !== positions[b * 3 + axis];
  const swap = (a: number, b: number) => {
    const value = order[a];
    order[a] = order[b];
    order[b] = value;
  };
  const median = (first: number, middle: number, last: number) => {
    if (different(order[middle], order[first])) swap(middle, first);
    if (different(order[last], order[middle])) {
      swap(last, middle);
      if (different(order[middle], order[first])) swap(middle, first);
    }
  };
  const partition = (first: number, last: number): [number, number] => {
    const middle = first + Math.floor((last - first) / 2);
    let lowSample = first;
    let highSample = last - 1;
    if (last - first - 1 > 40) {
      const step = Math.floor((last - first) / 8);
      lowSample = first + step;
      highSample -= step;
      median(first, lowSample, first + step * 2);
      median(middle - step, middle, middle + step);
      median(last - 1 - step * 2, highSample, last - 1);
    }
    median(lowSample, middle, highSample);
    let pivotFirst = middle;
    let pivotLast = middle + 1;
    while (
      first < pivotFirst &&
      !different(order[pivotFirst - 1], order[pivotFirst])
    )
      pivotFirst--;
    while (pivotLast < last && !different(order[pivotLast], order[pivotFirst]))
      pivotLast++;
    let forward = pivotLast;
    let backward = pivotFirst;
    // Both callback directions have identical nonzero truth values. The native
    // unequal-direction breaks are unreachable for finite axis coordinates.
    while (forward < last) {
      if (!different(order[pivotFirst], order[forward])) {
        if (pivotLast !== forward) swap(pivotLast, forward);
        pivotLast++;
      }
      forward++;
    }
    while (first < backward) {
      const previous = backward - 1;
      if (!different(order[previous], order[pivotFirst])) {
        pivotFirst--;
        if (pivotFirst !== previous) swap(pivotFirst, previous);
      }
      backward--;
    }
    return [pivotFirst, pivotLast];
  };
  const heapAdjust = (
    first: number,
    hole: number,
    size: number,
    value: number,
  ) => {
    const top = hole;
    const lastParent = Math.floor((size - 1) / 2);
    while (hole < lastParent) {
      let child = hole * 2 + 2;
      if (different(order[first + child], order[first + child - 1])) child--;
      order[first + hole] = order[first + child];
      hole = child;
    }
    if (hole === lastParent && size % 2 === 0) {
      order[first + hole] = order[first + size - 1];
      hole = size - 1;
    }
    while (top < hole) {
      const parent = Math.floor((hole - 1) / 2);
      if (!different(order[first + parent], value)) break;
      order[first + hole] = order[first + parent];
      hole = parent;
    }
    order[first + hole] = value;
  };
  const sort = (
    initialFirst: number,
    initialLast: number,
    initialBudget: number,
  ) => {
    let first = initialFirst;
    let last = initialLast;
    let budget = initialBudget;
    while (last - first > 32) {
      if (budget < 1) {
        const size = last - first;
        for (let hole = Math.floor(size / 2) - 1; hole >= 0; hole--)
          heapAdjust(first, hole, size, order[first + hole]);
        for (let end = last - 1; first < end; end--) {
          const value = order[end];
          order[end] = order[first];
          heapAdjust(first, 0, end - first, value);
        }
        return;
      }
      const [pivotFirst, pivotLast] = partition(first, last);
      budget = Math.floor(budget / 2) + Math.floor(budget / 4);
      if (pivotFirst - first < last - pivotLast) {
        sort(first, pivotFirst, budget);
        first = pivotLast;
      } else {
        sort(pivotLast, last, budget);
        last = pivotFirst;
      }
    }
    for (let index = first + 1; index < last; index++) {
      const value = order[index];
      let hole = index;
      if (different(value, order[first])) {
        while (first < hole) {
          order[hole] = order[hole - 1];
          hole--;
        }
      } else {
        while (first < hole && different(value, order[hole - 1])) {
          order[hole] = order[hole - 1];
          hole--;
        }
      }
      order[hole] = value;
    }
  };
  sort(0, count, count);
  return order;
}
