import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const root = new URL('../dist/', import.meta.url);
const requests = [];
const server = http.createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://127.0.0.1').pathname;
    const file = new URL(name === '/' ? 'index.html' : name.slice(1), root);
    if (!file.href.startsWith(root.href)) throw Error('invalid path');
    const bytes = await readFile(file);
    const ext = file.pathname.split('.').pop();
    if (name === '/sw.js') requests.push(200);
    res.writeHead(200, { 'Content-Type': ({html:'text/html',js:'application/javascript',css:'text/css',wasm:'application/wasm',json:'application/json'})[ext] ?? 'application/octet-stream' });
    res.end(bytes);
  } catch { if (req.url === '/sw.js') requests.push(404); res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
try {
  const url = `http://127.0.0.1:${server.address().port}/`;
  async function attempt() {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    const index = requests.length;
    await page.goto(url);
    for (let i=0; i<50 && requests.length === index; i++) await page.waitForTimeout(100);
    const status = requests[index];
    await page.waitForTimeout(500);
    await context.close();
    return {status, errors};
  }
  const before = await attempt();
  execFileSync(process.execPath, ['scripts/offline-manifest.mjs']);
  const after = await attempt();
  assert.equal(before.status, 404);
  assert(before.errors.some(value => value.includes('404')));
  assert.equal(after.status, 200);
  assert(!after.errors.some(value => value.includes('404')));
  console.log(JSON.stringify({before, after}));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
