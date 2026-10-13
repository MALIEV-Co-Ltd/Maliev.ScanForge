import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ReductionModeSelect,
  reductionModes,
} from "../src/ui/ReductionModeSelect";

it.each(reductionModes)(
  "reports the selected reduction mode: $value",
  ({ value, label }) => {
    const html = renderToStaticMarkup(
      <ReductionModeSelect
        value={value}
        disabled={false}
        onChange={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Reduce by"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(label);
    expect(html).not.toContain("<select");
    expect(html).not.toContain('disabled=""');
  },
);
it("disables reduction-mode interaction only while busy", () => {
  const html = renderToStaticMarkup(
    <ReductionModeSelect
      value="percentage"
      disabled={true}
      onChange={() => {}}
    />,
  );
  expect(html).toContain('disabled=""');
  expect(html).toContain('aria-expanded="false"');
});
