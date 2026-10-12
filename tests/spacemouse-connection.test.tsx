import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SpaceMouseConnection } from "../src/ui/SpaceMouseConnection";

const defaults = {
  status: "Disconnected",
  connected: false,
  connecting: false,
  available: true,
  onConnect: () => {},
  onSettings: () => {},
};
describe("viewport SpaceMouse connection", () => {
  it("provides a compact action with an accessible name and live status", () => {
    const html = renderToStaticMarkup(
      <SpaceMouseConnection
        {...defaults}
        compact
        connected
        status="Receiving motion: device"
      />,
    );
    expect(html).toContain('aria-label="SpaceMouse settings"');
    expect(html).toContain('class="spacemouse-connection compact"');
    expect(html).toContain('class="visually-hidden"');
    expect(html).toContain("spacemouse-connected-dot");
  });
  it("offers permission directly before a device is authorized", () => {
    const html = renderToStaticMarkup(<SpaceMouseConnection {...defaults} />);
    expect(html).toContain("Connect SpaceMouse");
    expect(html).toContain("Browser permission needed");
    expect(html).not.toContain("disabled=");
  });
  it("invokes connection synchronously from the disconnected button", () => {
    const onConnect = vi.fn(),
      onSettings = vi.fn();
    const tree = SpaceMouseConnection({ ...defaults, onConnect, onSettings });
    tree.props.children[0].props.onClick();
    expect(onConnect).toHaveBeenCalledOnce();
    expect(onSettings).not.toHaveBeenCalled();
  });
  it("offers preferences and distinguishes waiting from received motion", () => {
    const onConnect = vi.fn(),
      onSettings = vi.fn();
    const tree = SpaceMouseConnection({
      ...defaults,
      connected: true,
      status: "Connected: device — waiting for motion reports",
      onConnect,
      onSettings,
    });
    tree.props.children[0].props.onClick();
    expect(onSettings).toHaveBeenCalledOnce();
    expect(onConnect).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(tree)).toContain(
      "Connected · waiting for motion",
    );
    expect(
      renderToStaticMarkup(
        <SpaceMouseConnection
          {...defaults}
          connected
          status="Receiving motion: device"
        />,
      ),
    ).toContain("Receiving motion");
  });
  it("disables duplicate requests while the chooser is pending", () => {
    const html = renderToStaticMarkup(
      <SpaceMouseConnection {...defaults} connecting />,
    );
    expect(html).toContain("disabled=");
    expect(html).toContain("Choose your device in the browser dialog");
  });
  it("explains unsupported browsers instead of offering a dead action", () => {
    const html = renderToStaticMarkup(
      <SpaceMouseConnection {...defaults} available={false} />,
    );
    expect(html).toContain("disabled=");
    expect(html).toContain("WebHID is unavailable in this browser");
    expect(html).not.toContain("Browser permission needed");
  });
});
