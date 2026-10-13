import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          id.replaceAll("\\", "/").includes("/automation/")
            ? "agent-api"
            : undefined,
      },
    },
  },
});
