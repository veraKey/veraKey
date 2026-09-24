// Runs before `npm publish` from this folder, which would publish the workspace manifest: its exports
// point at the TypeScript source, and only pnpm swaps in publishConfig's. Publishing the checked tarball
// (`npm publish <tarball>`) runs no scripts, and pnpm applies publishConfig itself.
if (!process.env.npm_config_user_agent?.startsWith("pnpm/")) {
  console.error("Publish the checked tarball instead: `pnpm sdk:pack`, then `npm publish packages/sdk/verakey-sdk-<version>.tgz --access public`.");
  process.exit(1);
}
