import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  plugins: [
    {
      name: "development-offline-worker-reset",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if ((request as { url?: string }).url?.split("?")[0] !== "/sw.js")
            return next();
          response.setHeader("Content-Type", "application/javascript");
          response.setHeader("Cache-Control", "no-store");
          // Replace a production worker previously installed on the development origin.
          response.end(`self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  await self.clients.claim();
  await self.registration.unregister();
  await Promise.all((await caches.keys()).filter(key=>key.startsWith('scanforge-')).map(key=>caches.delete(key)));
  for(const client of await self.clients.matchAll({type:'window'}))await client.navigate(client.url);
})()));`);
        });
      },
    },
  ],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          const path = id.replaceAll("\\", "/");
          if (path.endsWith("/src/automation/catalog.json"))
            return "automation-catalog";
          return path.includes("/automation/") ? "agent-api" : undefined;
        },
      },
    },
  },
});
