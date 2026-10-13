import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppSelect, menuOptions } from "../src/ui/AppSelect";
it("retains dynamic labels and disabled options", () => {
  const options = menuOptions(
    <>
      <option value="">Choose object</option>
      {["a", "b"].map((id) => (
        <option key={id} value={id} disabled={id === "b"}>
          {id}
        </option>
      ))}
    </>,
  );
  expect(options.map((o) => [o.value, o.disabled])).toEqual([
    ["", false],
    ["a", false],
    ["b", true],
  ]);
});
it("exposes a keyboard popup and preserves hidden form semantics", () => {
  const html = renderToStaticMarkup(
    <AppSelect
      id="units"
      name="units"
      value="mm"
      aria-label="Units"
      icons={{ mm: <svg aria-hidden="true" /> }}
    >
      <option value="mm">Millimeter</option>
      <option value="inch">Inch</option>
    </AppSelect>,
  );
  expect(html).toContain('aria-haspopup="listbox"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('id="units"');
  expect(html).toContain('name="units"');
  expect(html).toContain("display:none");
  expect(html).toContain("<svg");
  expect(html).toContain('selected=""');
});
it("preserves explicit disabled and autofocus state", () => {
  const html = renderToStaticMarkup(
    <AppSelect disabled autoFocus>
      <option value="x">X</option>
    </AppSelect>,
  );
  expect(html).toContain('disabled=""');
  expect(html).toContain('autofocus=""');
});
