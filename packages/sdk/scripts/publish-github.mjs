// Publishes the checked tarball from `pnpm sdk:pack` to GitHub Packages too, so the repository lists it under
// Packages. People still install from npm: GitHub's registry asks for a token even to install a public package.
// GitHub links the package to github.com/veraKey/veraKey through its repository field, and the @verakey scope
// matches the veraKey account, as GitHub requires.
//
//   GH_TOKEN=<classic token with write:packages> pnpm sdk:publish:github     (DRY_RUN=1 to only show what it would do)
//
// The token stays in the environment: the temporary npmrc names ${GH_TOKEN}, and npm reads the value when it runs.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(sdk, "package.json"), "utf8"));
const tarball = join(sdk, `verakey-sdk-${version}.tgz`);

if (!process.env.GH_TOKEN) {
  console.error("Set GH_TOKEN to a classic GitHub token with the write:packages scope.");
  process.exit(1);
}
if (!existsSync(tarball)) {
  console.error(`${relative(process.env.INIT_CWD ?? process.cwd(), tarball)} is missing: run \`pnpm sdk:pack\` first.`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "verakey-github-npmrc-"));
const npmrc = join(dir, "npmrc");
writeFileSync(npmrc, "//npm.pkg.github.com/:_authToken=${GH_TOKEN}\n", { mode: 0o600 });
try {
  const args = ["publish", tarball, "--registry=https://npm.pkg.github.com", `--userconfig=${npmrc}`];
  execFileSync("npm", process.env.DRY_RUN ? [...args, "--dry-run"] : args, { stdio: "inherit" });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
