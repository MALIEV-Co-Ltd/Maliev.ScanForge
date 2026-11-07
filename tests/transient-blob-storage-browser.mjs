import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { transformSync } from "esbuild";
import { chromium } from "playwright";

const source = await readFile(
  new URL("../src/transient-blob-storage.ts", import.meta.url),
  "utf8",
);
const module = transformSync(source, { loader: "ts", format: "esm" }).code;
const server = http.createServer((request, response) => {
  const script = request.url === "/storage.js";
  response.writeHead(200, {
    "Content-Type": script ? "text/javascript" : "text/html",
  });
  response.end(script ? module : "<!doctype html><title>Storage test</title>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const { diskBackedBlob } = await import("/storage.js");
    const controller = new AbortController();
    const original = IDBDatabase.prototype.transaction;
    let armed = true;
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = original.apply(this, args);
      if (this.name === "scanforge-transient-blobs" && armed) {
        armed = false;
        tx.addEventListener("complete", () => controller.abort(), {
          once: true,
        });
      }
      return tx;
    };
    let error;
    try {
      await diskBackedBlob(
        new Blob([new Uint8Array(64 * 1024 * 1024)]),
        controller.signal,
      );
    } catch (failure) {
      error = failure.name;
    } finally {
      IDBDatabase.prototype.transaction = original;
    }
    const input = new Uint8Array(64 * 1024 * 1024);
    input[4096] = 37;
    const stored = await diskBackedBlob(new Blob([input]));
    const readback = new Uint8Array(
      await stored.slice(4096, 4097).arrayBuffer(),
    )[0];
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("scanforge-transient-blobs", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = await new Promise((resolve, reject) => {
      const tx = db.transaction("blobs");
      const request = tx.objectStore("blobs").count();
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase("scanforge-transient-blobs");
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Database cleanup blocked"));
    });
    return { error, count, readback };
  });
  assert.deepEqual(result, { error: "AbortError", count: 0, readback: 37 });
  console.log(
    "PASS: cancelled staging cleans up and successful staging retains bytes",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
