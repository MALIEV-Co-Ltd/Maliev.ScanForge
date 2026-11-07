import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { transformSync } from "esbuild";
import { chromium } from "playwright";

const source = transformSync(
  await readFile(
    new URL("../src/transient-blob-storage.ts", import.meta.url),
    "utf8",
  ),
  { loader: "ts", format: "esm" },
).code;
const workerSource = `import {diskBackedBlob} from '/storage.js';
const original=IDBDatabase.prototype.transaction;let armed=true;
IDBDatabase.prototype.transaction=function(...args){const tx=original.apply(this,args);if(this.name==='scanforge-transient-blobs'&&armed){armed=false;let handler;Object.defineProperty(tx,'oncomplete',{configurable:true,get:()=>handler,set:v=>{handler=v}});tx.addEventListener('complete',()=>postMessage('committed'),{once:true});}return tx};
diskBackedBlob(new Blob([new Uint8Array(64*1024*1024)]),undefined,'worker-key').then(()=>postMessage('unexpected-success'),e=>postMessage('error:'+e.message));`;
const server = http.createServer((request, response) => {
  const script =
    request.url === "/storage.js"
      ? source
      : request.url === "/worker.js"
        ? workerSource
        : undefined;
  response.writeHead(200, {
    "Content-Type": script ? "text/javascript" : "text/html",
  });
  response.end(script ?? "<!doctype html><title>Worker storage test</title>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("scanforge-transient-blobs", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("blobs");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("blobs", "readwrite");
      tx.objectStore("blobs").put(
        { file: new Blob(["keep"]), expires: Date.now() + 900000 },
        "other-key",
      );
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const worker = new Worker("/worker.js", { type: "module" });
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Worker did not reach commit")),
        30000,
      );
      worker.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data);
      };
      worker.onerror = (event) => reject(new Error(event.message));
    });
    worker.terminate();
    const { deleteTransientBlob } = await import("/storage.js");
    await deleteTransientBlob("worker-key");
    const reopened = await new Promise((resolve, reject) => {
      const request = indexedDB.open("scanforge-transient-blobs", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const keys = await new Promise((resolve, reject) => {
      const tx = reopened.transaction("blobs"),
        request = tx.objectStore("blobs").getAllKeys();
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    });
    reopened.close();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase("scanforge-transient-blobs");
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Database cleanup blocked"));
    });
    return { message, keys };
  });
  assert.deepEqual(result, { message: "committed", keys: ["other-key"] });
  console.log(
    "PASS: terminated worker's checkpoint is removed without deleting other records",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
