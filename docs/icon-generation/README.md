# Generated technical icons

The owner approved replacing all application icons with image-generated raster artwork on 2026-10-20. The visual reference is a shaded technical illustration of a milling operation.

Every icon is generated separately using the built-in image generation tool: isometric technical illustration, steel gray and muted blue, thin navy outlines, orange active geometry, blue motion arrows, transparent background, no text. Files in `receipts/` preserve the actual prompt and original generation path. `public/icons/generated/requests.json` is the complete asset inventory.

The complete set contains 220 independently generated icons. Runtime PNGs are exported at 128×128 pixels with preserved alpha, totaling 4,054,096 bytes. Run `pwsh -NoProfile -File scripts/export-generated-icons.ps1` after copying a new generated original into the asset directory. The full-resolution originals remain at the receipt paths.

The integration uses local image assets and preserves existing command IDs, labels, callbacks, state, and MCP operations. Runtime geometry and sketch previews remain live diagrams because they represent user data, rather than decorative icons.

Validation must cover inventory completeness and valid transparent image files, decorative accessibility, compact and full sizes, the production build and existing tests, offline asset inclusion, and browser rendering on light and dark surfaces. Preserve unrelated working-tree edits. Commit only this task's changes after validation.

Implementation sequence:

1. Inventory ribbon, selection, viewport, native view-cube controls, SpaceMouse, and common UI icons.
2. Generate each asset independently and retain its prompt receipt.
3. Replace decorative SVG renderers with local raster images.
4. Validate assets, build, focused tests, full suite, formatting, MCP contracts, and browser display.
5. Commit the coherent change without unrelated work or publication.

Validated on 2026-10-20: production build; 62 focused component, camera, and asset checks; the full suite with 47,100 passed and 54 existing skips; 99 focused MCP/API checks; and `node tests/generated-icons-browser.mjs` using an isolated installed Chrome session. The browser check decoded all 220 images, verified actual transparent and visible pixels, exercised the native view-cube controls, Settings and both themes, and produced light/dark contact sheets at 20, 40, and 80 pixels without console errors. The existing owner-dataset checks require `SCANFORGE_ALIGNMENT_EXAMPLES`, which was not configured for this run. Browser and loopback server cleanup was verified. Build/test evidence is retained under the ignored `.resources/generated-icons-20261020/` directory.
