import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  StatusMessage,
  ActiveToolHint,
  StatusBar,
  OperationStatus,
  completedStatusTimeout,
} from "../src/ui/StatusFeedback";
import { ImportProgress } from "../src/ui/ImportProgress";
it.each(["Importing mesh.stl · 50%", "Creating exact CAD body…"])(
  "provides pointer feedback for non-mesh jobs: %s",
  (message) => {
    const props = {
      shortcuts: { mode: "main" as const, availableActions: new Set<never>() },
      operation: <span />,
      hint: <span />,
      jobMessage: message,
    };
    expect(renderToStaticMarkup(<StatusBar {...props} busy />)).toContain(
      message.replace(/ · \d+%$/, ""),
    );
    expect(
      renderToStaticMarkup(<StatusBar {...props} busy={false} />),
    ).not.toContain('class="pointer-job-status"');
  },
);
it("renders operation progress separately from scrolling text, including completed progress", () => {
  for (const fraction of [0, 0.5, 1]) {
    const html = renderToStaticMarkup(
      <OperationStatus
        message="Reduction complete · 100%"
        fraction={fraction}
        busy={fraction < 1}
      />,
    );
    expect(html).toContain('role="progressbar"');
    expect(html).toContain(`aria-valuenow="${fraction * 100}"`);
    expect(html).toContain("status-operation-track");
  }
});
it("expires completed feedback at five seconds and cancels stale operation timers", () => {
  vi.useFakeTimers();
  try {
    const ready = vi.fn();
    completedStatusTimeout(ready);
    vi.advanceTimersByTime(4999);
    expect(ready).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ready).toHaveBeenCalledOnce();
    const stale = vi.fn();
    const cancel = completedStatusTimeout(stale);
    cancel();
    vi.advanceTimersByTime(5000);
    expect(stale).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
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
it("shows a brief idle hint and retains detailed navigation on hover", () => {
  const html = renderToStaticMarkup(
    <ActiveToolHint context={{ mode: "inspect" }} />,
  );
  const visible = html.slice(html.indexOf(">") + 1);
  expect(visible).toContain("Select an object");
  expect(visible).not.toContain("orbits");
  expect(html).toContain("Middle-drag orbits");
});

it("groups progress, command guidance, and model details with shortcuts on the right", () => {
  const html = renderToStaticMarkup(
    <StatusBar
      busy
      facets={12345}
      shortcuts={{ mode: "main", availableActions: new Set() }}
      operation={
        <StatusMessage message="Importing mesh">
          <ImportProgress name="mesh.stl" fraction={0.5} onCancel={() => {}} />
        </StatusMessage>
      }
      hint={<ActiveToolHint context={{ mode: "inspect" }} />}
    />,
  );
  const operation = html.slice(
    html.indexOf('aria-label="Operation progress"'),
    html.indexOf('aria-label="Command guidance"'),
  );
  const guidance = html.slice(
    html.indexOf('aria-label="Command guidance"'),
    html.indexOf('aria-label="Model information"'),
  );
  const details = html.slice(html.indexOf('aria-label="Model information"'));
  expect(operation).toContain('role="progressbar"');
  expect(operation).toContain('aria-label="Cancel import"');
  expect(guidance).toContain('aria-label="Active tool controls"');
  expect(guidance).not.toContain('aria-label="Keyboard shortcuts"');
  expect(details).toContain("12,345");
  expect(details).toContain("JS heap:");
  expect(details).toContain("Units: mm");
  expect(details).toContain('aria-label="Keyboard shortcuts"');
  expect(details).toContain("Modeling shortcuts paused while processing.");
});
