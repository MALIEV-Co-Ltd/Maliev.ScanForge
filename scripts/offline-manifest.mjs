import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../dist/", import.meta.url);
const files = [];
async function inventory(directory, prefix = "") {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${item.name}`;
    if (item.isDirectory())
      await inventory(new URL(`${item.name}/`, directory), `${relative}/`);
    else if (item.name !== "sw.js") files.push(relative);
  }
}
await inventory(root);
files.sort();
const hash = createHash("sha256");
for (const name of files) {
  hash.update(name);
  hash.update(await readFile(new URL(name, root)));
}
const cache = `scanforge-${hash.digest("hex").slice(0, 16)}`;
await writeFile(
  new URL("sw.js", root),
  `// Generated from the complete static build. No user CAD data is cached here.
const CACHE=${JSON.stringify(cache)};
const ASSETS=${JSON.stringify(files.map((name) => `./${name}`))};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('scanforge-')&&key!==CACHE).map(key=>caches.delete(key)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  const url=new URL(event.request.url);
  const root=new URL('./',self.location.href);
  const asset=ASSETS.find(name=>new URL(name,root).href===url.href);
  if(event.request.mode==='navigate'&&url.href.startsWith(root.href))event.respondWith(caches.open(CACHE).then(cache=>cache.match(new URL('index.html',root).href)).then(response=>response||fetch(event.request)));
  else if(asset)event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(response=>response||fetch(event.request)));
});
`,
);
console.log(
  `Offline manifest generated: ${files.length} local assets, ${cache}`,
);
