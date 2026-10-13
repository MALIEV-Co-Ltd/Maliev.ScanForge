import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Ribbon } from "../src/ui/Ribbon";
import { ProjectRecovery } from "../src/ui/ProjectRecovery";
it("places backup and recovery in Main ribbon and excludes it from other tabs and utility header", () => {
  const props = {
    activeTab: "main",
    onTabChange: () => {},
    actions: {},
    disabled: false,
    hasSelection: false,
    canUndo: false,
    canRedo: false,
    utilityHeader: <span>App utilities</span>,
    projectRecovery: (
      <ProjectRecovery
        backups={[]}
        status="Backup ready"
        disabled={false}
        offerRecovery={false}
        onRestore={() => {}}
      />
    ),
  };
  const main = renderToStaticMarkup(<Ribbon {...props} />);
  expect(main).toContain('aria-label="Backup and recovery"');
  expect(main.indexOf('aria-label="Backup and recovery"')).toBeGreaterThan(
    main.indexOf('aria-label="File"'),
  );
  expect(
    main.slice(
      main.indexOf('class="header-utilities"'),
      main.indexOf('class="ribbon-tools-shell"'),
    ),
  ).not.toContain("Backup and recovery");
  expect(
    renderToStaticMarkup(<Ribbon {...props} activeTab="cad" />),
  ).not.toContain('aria-label="Backup and recovery"');
});
