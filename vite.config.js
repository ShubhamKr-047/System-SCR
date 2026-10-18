import { defineConfig } from "vite";
import { resolve } from "node:path";
import { copyFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";

function extensionStaticFiles() {
  return {
    name: "extension-static-files",
    closeBundle() {
      const out = resolve("dist");
      for (const file of ["manifest.json", "background.js", "content.js"]) {
        copyFileSync(resolve(file), resolve(out, file));
      }
      const engineSrc = resolve("public/engine");
      const engineDst = resolve(out, "engine");
      mkdirSync(engineDst, { recursive: true });
      if (existsSync(engineSrc)) {
        for (const f of ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm", "Copying.txt"]) {
          const p = resolve(engineSrc, f);
          if (existsSync(p)) copyFileSync(p, resolve(engineDst, f));
        }
      }
      const piecesSrc = resolve("public/pieces");
      const piecesDst = resolve(out, "pieces");
      mkdirSync(piecesDst, { recursive: true });
      if (existsSync(piecesSrc)) {
        for (const f of readdirSync(piecesSrc)) {
          copyFileSync(resolve(piecesSrc, f), resolve(piecesDst, f));
        }
      }
    }
  };
}

export default defineConfig({
  base: "./",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        review: resolve("review.html"),
        popup: resolve("popup.html")
      }
    }
  },
  plugins: [extensionStaticFiles()]
});