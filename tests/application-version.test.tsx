import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ApplicationVersion } from "../src/ui/ApplicationVersion";
import { version } from "../package.json";

it("shows the package version and links to repository change history", () => {
  const html = renderToStaticMarkup(<ApplicationVersion />);
  expect(html).toContain(
    `<span class="application-version-badge">v${version}</span>`,
  );
  expect(html).toContain("lucide-github");
  expect(html.indexOf("application-version-badge")).toBeLessThan(
    html.indexOf("lucide-github"),
  );
  expect(html).toContain(
    'href="https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/releases"',
  );
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).not.toContain("SCAN TO CAD");
});
