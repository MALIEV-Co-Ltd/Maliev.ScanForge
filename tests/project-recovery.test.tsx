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
        status="Backed up at 14:00"
        disabled={false}
        offerRecovery={false}
        onRestore={() => {}}
      />
    ),
  };
  const main = renderToStaticMarkup(<Ribbon {...props} />);
  expect(main).toContain('aria-label="Backup"');
  expect(main).not.toContain("Backed up at");
  expect(main).not.toContain("backup-status");
  expect(main).not.toContain("Backup and recovery");
  expect(main.indexOf('aria-label="Backup"')).toBeGreaterThan(
    main.indexOf('aria-label="File"'),
  );
  expect(
    main.slice(
      main.indexOf('class="header-utilities"'),
      main.indexOf('class="ribbon-tools-shell"'),
    ),
  ).not.toContain('aria-label="Backup"');
  expect(
    renderToStaticMarkup(<Ribbon {...props} activeTab="cad" />),
  ).not.toContain('aria-label="Backup"');
});
it("separates project, saved date and snapshot from the selected restore action", () => {
  const html = renderToStaticMarkup(
    <ProjectRecovery
      backups={[
        {
          id: "session",
          name: "Bracket",
          savedAt: 1791882000000,
          file: new Blob(),
        },
        {
          id: "session:previous",
          name: "Bracket",
          savedAt: 1791881000000,
          file: new Blob(),
        },
      ]}
      status="Backed up at 14:00"
      disabled={false}
      offerRecovery={false}
      onRestore={() => {}}
      onDelete={async () => {}}
    />,
  );
  expect(html).toContain('aria-label="Available project backups"');
  expect(html).toContain('scope="col">Project');
  expect(html).toContain('scope="col">Saved');
  expect(html).toContain('scope="col">Snapshot');
  expect(html).toContain("Bracket.scanforge");
  expect(html).toContain("Latest");
  expect(html).toContain("Previous");
  expect(html).toContain('type="radio"');
  expect(html).toMatch(/disabled="">Restore<\/button>/);
  expect(html).toContain('aria-label="Close project backups"');
  expect(html).toMatch(/disabled="">Delete<\/button>/);
  expect(html).toContain("recovery-thumbnail");
});
