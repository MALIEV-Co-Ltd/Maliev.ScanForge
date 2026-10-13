import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusMessage, ActiveToolHint } from "../src/ui/StatusFeedback";
import { ImportProgress } from "../src/ui/ImportProgress";
it("retains full operation text for assistive technology and hover while giving layout a dedicated bounded slot", () => {
  const message = "Operation " + "long details ".repeat(100);
  const html = renderToStaticMarkup(<StatusMessage message={message} />);
  expect(html).toContain('class="status-message"');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain(`title="${message}"`);
});
it("keeps import progress and cancellation inside the same status slot", () => {
  const html = renderToStaticMarkup(
    <StatusMessage message="Importing mesh">
      <ImportProgress name="mesh.stl" fraction={0.5} onCancel={() => {}} />
    </StatusMessage>,
  );
  expect(html).toContain('class="status-message"');
  expect(html).toContain('role="progressbar"');
  expect(html).toContain('aria-valuenow="50"');
  expect(html).toContain('aria-label="Cancel import"');
});
it("exposes changing tool instructions accessibly and in the hover title", () => {
  const html = renderToStaticMarkup(
    <ActiveToolHint
      context={{ mode: "brush", brushActive: true, selectionTool: "rectangle" }}
    />,
  );
  expect(html).toContain('aria-label="Active tool controls"');
  expect(html).toContain('tabindex="0"');
  expect(html).toContain("Left-drag draws selection rectangle");
  expect(html).toContain('title="Left-drag');
});
