import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
assert.equal(admission.status, 0, "Resource admission failed");
const assets = JSON.parse(
  await readFile(new URL("public/icons/generated/requests.json", root), "utf8"),
);
const artifacts = new URL(".resources/generated-icons-20261020/browser/", root);
await mkdir(artifacts, { recursive: true });
const ledger = {
  owner: "generated-icons-20261020",
  startedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 180000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
};
const mime = {
  html: "text/html",
  js: "application/javascript",
  css: "text/css",
  png: "image/png",
  json: "application/json",
  wasm: "application/wasm",
};
function processIdentity(pid) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `$taskProcess = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; @{pid=$taskProcess.ProcessId; startedAt=$taskProcess.CreationDate.ToUniversalTime().ToString('o'); executable=$taskProcess.ExecutablePath} | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(result.status, 0, result.stderr);
  const identity = JSON.parse(result.stdout);
  assert.equal(identity.pid, pid);
  return identity;
}
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://127.0.0.1").pathname,
    );
    const file = new URL(
      pathname === "/" ? "index.html" : pathname.slice(1),
      new URL("dist/", root),
    );
    assert(file.href.startsWith(new URL("dist/", root).href));
    const data = await readFile(file);
    response.writeHead(200, {
      "Content-Type":
        mime[file.pathname.split(".").pop()] ?? "application/octet-stream",
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
server.requestTimeout = 10000;
let browserServer, browser;
let watchdog;
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  ledger.resources.push({
    type: "loopback-static-server",
    ...processIdentity(process.pid),
    port: server.address().port,
  });
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--js-flags=--max-old-space-size=512", "--disable-dev-shm-usage"],
  });
  ledger.resources.push({
    type: "chromium",
    ...processIdentity(browserServer.process().pid),
    bridgePort: Number(new URL(browserServer.wsEndpoint()).port),
  });
  watchdog = setTimeout(() => {
    void browserServer.close();
    server.closeAllConnections();
    server.close();
  }, 150000);
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(origin, { waitUntil: "networkidle", timeout: 60000 });
  assert.match(await page.title(), /ScanForge/);
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
  assert.equal(await page.locator("vite-error-overlay").count(), 0);
  await page.locator(".camera-gizmo").hover();
  assert.equal(await page.locator(".cube-control img").count(), 8);
  assert.match(
    await page.locator(".cube-home img").getAttribute("src"),
    /camera-home\.png$/,
  );
  await page.locator(".cube-home").click();
  await page
    .getByRole("button", { name: "ViewCube settings", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "ViewCube settings", exact: true })
      .getAttribute("aria-expanded"),
    "true",
  );
  await page
    .getByRole("button", { name: "ViewCube settings", exact: true })
    .click();
  const loaded = await page
    .locator("img.generated-icon")
    .evaluateAll((images) =>
      images.every((image) => image.complete && image.naturalWidth > 0),
    );
  assert(loaded, "Visible application icons failed to load");
  await page.screenshot({
    path: fileURLToPath(new URL("application.png", artifacts)),
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL("settings.png", artifacts)),
  });
  for (const theme of ["light", "dark"]) {
    await page.getByRole("radio", { name: theme, exact: false }).check();
    await page.waitForFunction(
      (value) => document.documentElement.dataset.theme === value,
      theme,
    );
    await page
      .getByRole("button", { name: "Close settings", exact: true })
      .click();
    await page.screenshot({
      path: fileURLToPath(new URL(`application-${theme}.png`, artifacts)),
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor();
  }
  assert.equal(errors.length, 0, errors.join("\n"));
  const gallery = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
  });
  await gallery.goto(origin, { waitUntil: "domcontentloaded" });
  const pixelResults = await gallery.evaluate(
    async (ids) => {
      const results = [];
      for (const id of ids) {
        const image = new Image();
        image.src = `/icons/generated/${id}.png`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        let clear = 0,
          visible = 0;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] === 0) clear++;
          if (pixels[i] > 100) visible++;
        }
        results.push({
          id,
          width: canvas.width,
          height: canvas.height,
          clear,
          visible,
        });
      }
      return results;
    },
    assets.map(({ id }) => id),
  );
  for (const result of pixelResults) {
    assert.equal(result.width, 128, result.id);
    assert.equal(result.height, 128, result.id);
    assert(result.clear > 100, `${result.id}: transparent backdrop`);
    assert(result.visible > 100, `${result.id}: visible artwork`);
  }
  for (let offset = 0; offset < assets.length; offset += 48) {
    const subset = assets.slice(offset, offset + 48);
    await gallery.setContent(
      `<style>body{font:12px system-ui;background:#e9edf1;margin:12px}.grid{display:grid;grid-template-columns:repeat(8,1fr);gap:8px}.tile{background:white;border:1px solid #bcc5cd;border-radius:4px;overflow:hidden}.samples{display:flex;align-items:center;justify-content:space-around;height:94px}.dark{background:#202830}.light{background:#fff}.label{padding:5px;text-align:center;color:#223;overflow-wrap:anywhere}img{object-fit:contain}</style><div class="grid">${subset.map(({ id }) => `<div class="tile"><div class="samples light"><img width="80" height="80" src="${origin}/icons/generated/${id}.png"><img width="40" height="40" src="${origin}/icons/generated/${id}.png"><img width="20" height="20" src="${origin}/icons/generated/${id}.png"></div><div class="samples dark"><img width="80" height="80" src="${origin}/icons/generated/${id}.png"><img width="40" height="40" src="${origin}/icons/generated/${id}.png"><img width="20" height="20" src="${origin}/icons/generated/${id}.png"></div><div class="label">${id}</div></div>`).join("")}</div>`,
    );
    await gallery
      .locator("img")
      .evaluateAll((images) =>
        Promise.all(images.map((image) => image.decode())),
      );
    await gallery.screenshot({
      path: fileURLToPath(new URL(`contact-${offset / 48 + 1}.png`, artifacts)),
      fullPage: true,
    });
  }
  const bytes = (
    await Promise.all(
      assets.map(({ id }) =>
        stat(new URL(`public/icons/generated/${id}.png`, root)),
      ),
    )
  ).reduce((sum, file) => sum + file.size, 0);
  assert(bytes < 8 * 1024 * 1024, "Runtime icon set exceeds 8 MiB");
  ledger.results = {
    icons: pixelResults.length,
    bytes,
    consoleErrors: errors,
    checks: [
      "app identity and content",
      "visible images load",
      "settings interaction",
      "every asset decodes with real transparency and visible pixels",
      "20/40/80px light and dark contact sheets",
    ],
  };
  console.log(
    `PASS: ${pixelResults.length} generated transparent icons, ${bytes} bytes; application and Settings render without console errors.`,
  );
} finally {
  clearTimeout(watchdog);
  if (browser) await browser.close();
  if (browserServer) {
    await browserServer.close();
    assert.notEqual(browserServer.process().exitCode, null);
    ledger.cleanup.push("Chromium process exited");
  }
  server.closeAllConnections();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  assert.equal(server.listening, false);
  ledger.cleanup.push("loopback server closed");
  await writeFile(
    new URL("validation.json", artifacts),
    JSON.stringify(ledger, null, 2) + "\n",
  );
}
