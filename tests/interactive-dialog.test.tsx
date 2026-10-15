import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InteractiveAlignmentDialog } from "../src/ui/InteractiveAlignmentDialog";
import { InteractiveAlignmentStore } from "../src/interactive-alignment-store";
import { InteractiveAlignmentSession } from "../src/interactive-alignment-session";
function markup(busy = false, mirrorAvailable = false) {
  const store = new InteractiveAlignmentStore();
  store.publish(
    new InteractiveAlignmentSession(
      [
        {
          id: "scan",
          name: "Scan",
          kind: "mesh",
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          color: "#aaa",
          opacity: 1,
          visible: true,
        },
      ],
      ["scan"],
      [0, 0, 0],
    ).inspect(),
  );
  const action = vi.fn(async () => ({}));
  return renderToStaticMarkup(
    <InteractiveAlignmentDialog
      store={store}
      busy={busy}
      mirrorAvailable={mirrorAvailable}
      onEdit={action}
      onApply={action}
      onCancel={action}
    />,
  );
}
it("uses Kbd cancellation guidance and disables mesh-only mirror controls without a mesh source", () => {
  const html = markup();
  expect(html).toContain("1 scan selected");
  expect(html).toMatch(/<kbd[^>]*>Escape<\/kbd>/);
  const checkbox = html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0];
  expect(checkbox).toContain('disabled=""');
  expect(html).toContain("point-cloud");
});
it("pauses editing during an API operation but leaves Cancel available", () => {
  const html = markup(true, true);
  expect(html).toContain('<fieldset disabled="">');
  expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Cancel<\/button>/);
});
