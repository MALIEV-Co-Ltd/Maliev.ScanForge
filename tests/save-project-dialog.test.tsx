import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SaveProjectDialog } from "../src/ui/SaveProjectDialog";

it("asks for the existing project name in an accessible save dialog", () => {
  const html = renderToStaticMarkup(
    <SaveProjectDialog
      name="Bracket scan"
      onSave={() => {}}
      onCancel={() => {}}
    />,
  );
  expect(html).toContain('role="dialog"');
  expect(html).toContain('aria-modal="true"');
  expect(html).toContain('for="save-project-name"');
  expect(html).toContain('value="Bracket scan"');
  expect(html).toContain('maxLength="200"');
  expect(html).toContain('type="submit"');
  expect(html).toContain('type="button"');
});
it("disables saving a whitespace-only project name", () => {
  const html = renderToStaticMarkup(
    <SaveProjectDialog name="   " onSave={() => {}} onCancel={() => {}} />,
  );
  expect(html).toContain('type="submit" disabled');
});
