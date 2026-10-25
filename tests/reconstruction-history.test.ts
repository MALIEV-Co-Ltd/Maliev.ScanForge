import { expect, it } from "vitest";
import { seekModelRevision, type Revision } from "../src/history";
import {
  encodeProjectFileLocally,
  decodeProjectFile,
} from "../src/project-file";
import type { Entity } from "../src/types";
const scan: Entity = {
  id: "scan",
  name: "Scan",
  kind: "mesh",
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  visible: true,
  color: "#ffffff",
  opacity: 1,
};
it("restores modeling visibility through undo, redo, seek and save/reopen while retaining ordinary display edits", async () => {
  const before = [scan, { ...scan, id: "unrelated" }];
  const after = [
    { ...scan, visible: false },
    { ...scan, id: "unrelated", visible: false },
    { ...scan, id: "output" },
  ];
  const history = [
    { label: "Reconstruct", entities: before, restoreVisibilityFor: ["scan"] },
  ] as Revision[];
  const decoded = await decodeProjectFile(
    await encodeProjectFileLocally({
      project: {
        format: "maliev-scanforge",
        version: 1,
        units: "mm",
        name: "Reconstruct",
        entities: after,
      },
      history,
      future: [],
    }),
  );
  const undo = seekModelRevision(
    decoded.history,
    decoded.project.entities,
    [],
    0,
  );
  expect(undo.entities.find((e) => e.id === "scan")!.visible).toBe(true);
  expect(undo.entities.find((e) => e.id === "unrelated")!.visible).toBe(false);
  const redo = seekModelRevision(undo.history, undo.entities, undo.future, 1);
  expect(redo.entities.find((e) => e.id === "scan")!.visible).toBe(false);
  expect(redo.entities.find((e) => e.id === "unrelated")!.visible).toBe(false);
  expect(redo.history[0].restoreVisibilityFor).toEqual(["scan"]);
});
