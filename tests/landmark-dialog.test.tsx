import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LandmarkAlignmentDialog } from "../src/ui/LandmarkAlignmentDialog";
import { beginLandmarkAlignment } from "../src/landmark-alignment";
import type { Entity } from "../src/types";
const moving: Entity = {
  id: "moving",
  name: "Moving",
  kind: "mesh",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  color: "#aaa",
  visible: true,
  opacity: 1,
};
const fixed = { ...moving, id: "fixed", name: "Fixed" };
const noop = () => {};
it("keeps preview and accept unavailable until their prerequisites and permits cancelling a worker", () => {
  const markup = renderToStaticMarkup(
    <LandmarkAlignmentDialog
      session={beginLandmarkAlignment(moving, fixed)}
      targets={[fixed]}
      busy={true}
      pickSide="moving"
      onPickSide={noop}
      onTarget={noop}
      onTargetScope={noop}
      onRemoveLast={noop}
      onRemoveAll={noop}
      onPreview={noop}
      onAccept={noop}
      onCancel={noop}
      onReset={noop}
    />,
  );
  expect(markup).toContain(
    'disabled="" class="tool-preview-button" aria-label="Preview"',
  );
  expect(markup).toMatch(/<button disabled="">OK<\/button>/);
  expect(markup).toContain("<button>Cancel</button>");
  expect(markup).toContain('aria-label="Moving landmarks"');
  expect(markup).toContain('aria-label="Fixed landmarks"');
});
