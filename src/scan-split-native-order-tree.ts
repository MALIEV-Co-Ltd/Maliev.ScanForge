import { Box3, Triangle, Vector3 } from "three";

type Face = { index: number; triangle: Triangle };
type State = { references: number; maxReferences: number };
type Node<T extends Face> = {
  box: Box3;
  faces: T[];
  depth: number;
  state: State;
  children?: Node<T>[];
};

// Experimental ordering hypothesis. Expand only nodes visited by source queries.
export function buildExperimentalNativeTree<T extends Face>(
  box: Box3,
  faces: T[],
  check: () => void,
  options: { maxReferences?: number } = {},
): Node<T> {
  const maxReferences = options.maxReferences ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maxReferences) || maxReferences < 0)
    throw new Error("Finite cutter tree reference budget is invalid.");
  check();
  if (faces.length > maxReferences)
    throw new Error("Finite cutter tree reference budget exceeded.");
  return {
    box,
    faces,
    depth: 0,
    state: { references: faces.length, maxReferences },
  };
}

export function visitExperimentalNativeTree<T extends Face>(
  tree: Node<T>,
  query: Box3,
  visit: (face: T) => void,
  check: () => void,
): void {
  check();
  if (!tree.box.intersectsBox(query)) return;
  if (
    !tree.children &&
    !(
      tree.depth > 0 &&
      (tree.faces.length < 25 ||
        tree.box.max.x - tree.box.min.x <= 0.5 ||
        tree.depth >= 10)
    )
  ) {
    const lo = tree.box.min.toArray(),
      hi = tree.box.max.toArray();
    const mid = lo.map((v, i) => (v + hi[i]) * 0.5);
    let references = tree.state.references;
    const children = Array.from({ length: 8 }, (_, slot) => {
      check();
      const lower = lo.map((v, i) => (slot & (1 << i) ? v : mid[i]));
      const upper = hi.map((v, i) => (slot & (1 << i) ? mid[i] : v));
      const box = new Box3(
        new Vector3(...(lower as [number, number, number])),
        new Vector3(...(upper as [number, number, number])),
      );
      const faces: T[] = [];
      for (const face of tree.faces) {
        check();
        if (box.intersectsTriangle(face.triangle)) {
          if (++references > tree.state.maxReferences)
            throw new Error("Finite cutter tree reference budget exceeded.");
          faces.push(face);
        }
      }
      return { box, faces, depth: tree.depth + 1, state: tree.state };
    });
    tree.state.references = references;
    tree.children = children;
    tree.faces = [];
  }
  if (tree.children)
    for (const child of tree.children)
      visitExperimentalNativeTree(child, query, visit, check);
  else
    for (const face of tree.faces) {
      check();
      visit(face);
    }
}
