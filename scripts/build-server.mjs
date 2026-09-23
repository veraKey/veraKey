// Bundles the relayer and all of its dependencies into dist/index.js, so `node dist/index.js` runs
// without node_modules (the Docker image ships only dist/ and deployments/).
import { build } from "esbuild";

await build({
  entryPoints: ["server/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Bundled CommonJS dependencies (express) call require(), which ESM output has to provide.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});
