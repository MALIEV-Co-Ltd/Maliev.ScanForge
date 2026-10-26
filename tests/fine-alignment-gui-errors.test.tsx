import { expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { MeshTools } from "../src/ui/MeshTools";
import type { Entity } from "../src/types";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: unknown) => [initial === "" ? "fixed" : initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: vi.fn(),
}));

it("reports invalid target binding through the GUI error callback without dispatching work", async () => {
  const moving: Entity = {
    id: "moving",
    name: "Moving",
    kind: "mesh",
    visible: true,
    color: "#aaa",
    opacity: 1,
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  };
  const fixed: Entity = {
    ...moving,
    id: "fixed",
    name: "Fixed",
    indexedMesh: { vertices: moving.positions, triangles: [0, 1, 9] },
  };
  const onError = vi.fn(),
    onReplace = vi.fn();
  const tree = MeshTools({
    entities: [moving, fixed],
    selected: moving,
    onReplace,
    onCreateSegments: vi.fn(),
    onStatus: vi.fn(),
    onError,
  });
  let click: (() => void) | undefined;
  function visit(node: unknown) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!isValidElement<{ children?: unknown; onClick?: () => void }>(node))
      return;
    if (
      node.type === "button" &&
      node.props.children === "Fine align with dense ICP"
    )
      click = node.props.onClick;
    visit(node.props.children);
  }
  visit(tree);
  expect(click).toBeTypeOf("function");
  expect(() => click!()).not.toThrow();
  await Promise.resolve();
  expect(onError).toHaveBeenCalledWith(
    "Fine alignment target has an invalid vertex reference.",
  );
  expect(onReplace).not.toHaveBeenCalled();
});
