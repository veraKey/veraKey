import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Connect, type Plugin } from "vite";

const ROOT = import.meta.dirname;
const WEB_PORT = Number(process.env.VERAKEY_WEB_PORT ?? 5190);
const API_PORT = Number(process.env.VERAKEY_API_PORT ?? 3090);

// Cross-origin isolation gives bb.js SharedArrayBuffer, i.e. multi-threaded proving. Every
// subresource must then be same-origin or CORS-enabled, so fonts and the proving CRS are self-hosted.
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/**
 * Cross-origin isolation for every page, except the Sign in with VeraKey popup: COOP would cut it off from the site
 * that opened it, so it isolates itself with Document-Isolation-Policy.
 */
function isolation(): Plugin {
  const setHeaders: Connect.NextHandleFunction = (req, res, next) => {
    if ((req.url ?? "").split("?")[0] === "/connect") {
      res.setHeader("Document-Isolation-Policy", "isolate-and-require-corp");
    } else {
      for (const [name, value] of Object.entries(isolationHeaders)) res.setHeader(name, value);
    }
    next();
  };
  return {
    name: "verakey-isolation",
    configureServer: server => void server.middlewares.use(setHeaders),
    configurePreviewServer: server => void server.middlewares.use(setHeaders),
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), isolation()],
  resolve: {
    alias: {
      "@": path.resolve(ROOT, "client", "src"),
      "@shared": path.resolve(ROOT, "shared"),
    },
  },
  envDir: ROOT,
  root: path.resolve(ROOT, "client"),
  build: {
    outDir: path.resolve(ROOT, "dist/public"),
    emptyOutDir: true,
    target: "esnext",
  },
  optimizeDeps: {
    exclude: ["@aztec/bb.js", "@noir-lang/noir_js", "@noir-lang/acvm_js", "@noir-lang/noirc_abi"],
    esbuildOptions: { target: "esnext" },
  },
  worker: { format: "es" },
  server: {
    host: "localhost",
    port: WEB_PORT,
    strictPort: true,
    proxy: { "/api": `http://localhost:${API_PORT}` },
    fs: {
      strict: true,
      allow: [ROOT],
      deny: [".env", ".env.*", "**/.*", "**/*.pem"],
    },
  },
});
