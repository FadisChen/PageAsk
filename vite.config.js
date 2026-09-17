import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = resolve(process.cwd());

export default defineConfig({
  root,
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    assetsInlineLimit: (filePath) => filePath.endsWith("audio-capture-worklet.js") ? false : undefined,
    target: "es2022",
    rollupOptions: {
      input: {
        sidepanel: resolve(root, "sidepanel.html"),
        options: resolve(root, "options.html"),
        background: resolve(root, "background.js"),
      },
      output: {
        entryFileNames: (chunk) => chunk.name === "background"
          ? "background.js"
          : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
