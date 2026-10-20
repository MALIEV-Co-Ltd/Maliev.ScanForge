import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { GeneratedIcon } from "../src/ui/GeneratedIcon";
import { FolderOpen, X } from "../src/ui/GeneratedUiIcons";
import requests from "../public/icons/generated/requests.json";

describe("image-generated application icons", () => {
  it("uses local decorative raster assets with explicit sizes", () => {
    const html = renderToStaticMarkup(
      <GeneratedIcon asset="ribbon-open" size={40} />,
    );
    expect(html).toContain("<img");
    expect(html).toContain('src="/icons/generated/ribbon-open.png"');
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width="40"');
    expect(html).not.toContain("<svg");
  });
  it("preserves existing common UI icon props", () => {
    const html = renderToStaticMarkup(
      <FolderOpen size={17} className="header-open" />,
    );
    expect(html).toContain("ui-FolderOpen.png");
    expect(html).toContain('width="17"');
    expect(html).toContain("header-open");
    expect(renderToStaticMarkup(<X size={14} />)).toContain("ui-X.png");
  });
  it("rejects missing inventory entries", () => {
    expect(() =>
      renderToStaticMarkup(<GeneratedIcon asset="missing" />),
    ).toThrow("Missing generated icon");
  });
  it("has a real transparent PNG and generation receipt for every unique asset", () => {
    expect(new Set(requests.map((request) => request.id)).size).toBe(
      requests.length,
    );
    for (const { id } of requests) {
      const bytes = readFileSync(`public/icons/generated/${id}.png`);
      expect(bytes.subarray(0, 8).toString("hex"), id).toBe("89504e470d0a1a0a");
      expect(bytes.readUInt32BE(16), id).toBeGreaterThanOrEqual(80);
      expect(bytes.readUInt32BE(20), id).toBeGreaterThanOrEqual(80);
      expect([4, 6], `${id}: alpha channel`).toContain(bytes[25]);
      expect(
        readFileSync(`docs/icon-generation/receipts/${id}.txt`, "utf8"),
        id,
      ).toContain("transparent");
    }
  });
  it("routes all common UI icons through the generated artwork", () => {
    for (const file of readdirSync("src/ui").filter((name) =>
      name.endsWith(".tsx"),
    )) {
      expect(readFileSync(`src/ui/${file}`, "utf8"), file).not.toMatch(
        /from ["']lucide-react["']/,
      );
    }
  });
  it("uses generated images for native view-cube controls outside React", () => {
    const source = readFileSync("src/camera-gizmo.ts", "utf8");
    const controls = source.slice(
      source.indexOf("const home ="),
      source.indexOf("this.element.append("),
    );
    expect(controls).not.toMatch(/<svg|createElementNS/);
    for (const id of ["camera-home", "camera-cw", "camera-ccw"])
      expect(controls).toContain(id);
  });
});
