// Packs @verakey/sdk the way it is published, then checks the tarball from a fresh project outside
// the workspace:
//   1. the manifest points every module at built files in the tarball, which ships no source or tests;
//   2. Node imports it: the sign-in helpers compute a known account address, and the prover makes and
//      verifies a real proof of a synthetic passkey assertion;
//   3. TypeScript resolves typed exports, with moduleResolution bundler and nodenext;
//   4. a bundler builds a page that uses Sign in with VeraKey without pulling in the prover.
// It leaves the checked tarball in packages/sdk, ready for `npm publish <tarball> --access public`.
//
//   pnpm sdk:pack            (from the repository root; KEEP=1 keeps the scratch project)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (command, args, cwd, stdio = "pipe") =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", stdio, "inherit"] });
const step = title => console.log(`\n▸ ${title}`);

/** The target of `subpath` in an exports map, with `*` patterns expanded. */
function resolveExport(exports, subpath) {
  if (exports[subpath]) return exports[subpath];
  for (const [key, value] of Object.entries(exports)) {
    const [prefix, suffix] = key.split("*");
    if (suffix === undefined || !subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const stem = subpath.slice(prefix.length, subpath.length - suffix.length);
    return Object.fromEntries(Object.entries(value).map(([condition, target]) => [condition, target.replace("*", stem)]));
  }
  return undefined;
}

async function main() {
  const { version } = JSON.parse(readFileSync(join(sdk, "package.json"), "utf8"));
  const tarball = join(sdk, `verakey-sdk-${version}.tgz`);
  rmSync(tarball, { force: true });

  step("pack");
  console.log(run("pnpm", ["pack", "--pack-destination", sdk], sdk).trim().split("\n").at(-1));
  assert.ok(existsSync(tarball), `pnpm pack wrote ${tarball}`);

  const work = mkdtempSync(join(tmpdir(), "verakey-sdk-check-"));
  try {
    step("manifest and contents");
    const entries = run("tar", ["-tvzf", tarball], work).split("\n").filter(Boolean).map(line => {
      const [, , size, , , path] = line.trim().split(/\s+/);
      return { path: path.replace(/^package\//, ""), size: Number(size) };
    });
    const files = entries.map(entry => entry.path);
    const manifest = JSON.parse(run("tar", ["-xzOf", tarball, "package/package.json"], work));
    assert.deepEqual(files.filter(path => /^(src|test|scripts)\//.test(path)), [], "the tarball ships no source, tests or scripts");
    // An inferred type can expand into a huge declaration that slows every consumer's type checker.
    const heavy = entries.filter(entry => entry.path.endsWith(".d.ts") && entry.size > 100_000);
    assert.deepEqual(heavy.map(entry => `${entry.path} (${entry.size} bytes)`), [], "every declaration file stays under 100 KB");
    for (const path of ["README.md", "LICENSE"]) assert.ok(files.includes(path), `the tarball has ${path}`);
    assert.equal(manifest.license, "MIT");
    assert.match(manifest.repository?.url ?? "", /github\.com\/veraKey\/veraKey/);
    assert.equal(manifest.main, "./dist/index.js");
    assert.equal(manifest.types, "./dist/index.d.ts");
    const modules = readdirSync(join(sdk, "src")).filter(name => name.endsWith(".ts")).map(name => name.slice(0, -3));
    for (const module of modules) {
      const subpath = module === "index" ? "." : `./${module}`;
      const target = resolveExport(manifest.exports, subpath);
      assert.ok(target?.import && target?.types, `@verakey/sdk${subpath.slice(1)} is exported`);
      for (const path of [target.import, target.types]) assert.ok(files.includes(path.replace(/^\.\//, "")), `${path} is in the tarball`);
    }
    console.log(`${files.length} files; ${modules.length} modules exported with JS and types`);

    step("install in a fresh project");
    writeFileSync(join(work, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
    run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", tarball], work, "inherit");

    step("Node: sign-in helpers and a real proof");
    writeFileSync(join(work, "node-check.mjs"), NODE_CHECK);
    run("node", ["node-check.mjs"], work, "inherit");

    step("TypeScript: bundler and nodenext resolution");
    writeFileSync(join(work, "types-check.ts"), TYPES_CHECK);
    const tsc = join(sdk, "node_modules/.bin/tsc");
    for (const resolution of ["bundler", "nodenext"]) {
      const compilerOptions = {
        strict: true, noEmit: true, skipLibCheck: true, target: "ES2022", lib: ["ES2022", "DOM"], types: [],
        module: resolution === "bundler" ? "ESNext" : "NodeNext", moduleResolution: resolution,
      };
      writeFileSync(join(work, `tsconfig.${resolution}.json`), JSON.stringify({ compilerOptions, files: ["types-check.ts"] }));
      run(tsc, ["-p", `tsconfig.${resolution}.json`], work, "inherit");
      console.log(`${resolution}: typed exports resolve`);
    }

    step("bundler: a sign-in page leaves the prover out");
    writeFileSync(join(work, "page.js"), PAGE);
    const { build } = await import("vite");
    const outDir = join(work, "page-dist");
    await build({
      root: work, configFile: false, logLevel: "warn",
      build: { outDir, emptyOutDir: true, lib: { entry: join(work, "page.js"), formats: ["es"], fileName: "page" } },
    });
    const outputs = readdirSync(outDir);
    const size = outputs.reduce((total, name) => total + statSync(join(outDir, name)).size, 0);
    const code = outputs.map(name => readFileSync(join(outDir, name), "latin1")).join("\n");
    assert.deepEqual(outputs.filter(name => !name.endsWith(".js")), [], "no wasm or other assets");
    assert.doesNotMatch(code, /barretenberg|noir_js|acvm/i, "no prover code");
    assert.ok(size < 300_000, `the page stays small (${size} bytes)`);
    console.log(`${outputs.join(", ")}: ${(size / 1024).toFixed(0)} KB, no prover`);

    // INIT_CWD is where `pnpm sdk:pack` was typed; pnpm runs this script from packages/sdk.
    const where = relative(process.env.INIT_CWD ?? process.cwd(), tarball);
    let onNpm = false;
    try {
      onNpm = execFileSync("npm", ["view", `@verakey/sdk@${version}`, "version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === version;
    } catch {} // not on npm yet
    console.log(onNpm
      ? `\n✓ checked. ${version} is already on npm, which refuses it twice: bump the version for a new release. GitHub Packages: GH_TOKEN=… pnpm sdk:publish:github`
      : `\n✓ ready to publish: npm publish ${where} --access public, then GH_TOKEN=… pnpm sdk:publish:github for GitHub Packages`);
  } finally {
    if (process.env.KEEP) console.log(`kept ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

// Runs in the fresh project, against the installed tarball.
const NODE_CHECK = `
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import * as root from "@verakey/sdk";
import { VeraKeyConnect } from "@verakey/sdk/connect";
import { appIdFromName, computeNullifier } from "@verakey/sdk/nullifier";
import { VeraKeyProver } from "@verakey/sdk/prover";
import { accountAddressOf, appIdFromOrigin, verifySignIn } from "@verakey/sdk/signin";
import { normalizeLowS, publicKeyFromSpki } from "@verakey/sdk/webauthn";

for (const name of ["VeraKeyClient", "VeraKeyProver", "VeraKeyConnect", "verifySignIn", "appIdFromName"]) {
  assert.equal(typeof root[name], "function", "the root exports " + name);
}
assert.equal(typeof VeraKeyConnect, "function");
assert.equal(typeof verifySignIn, "function");
assert.equal(appIdFromOrigin("https://game.example"), appIdFromOrigin("https://game.example/"));
// factory.accountAddress(1, 2) on Arbitrum Sepolia, as in the SDK's unit tests.
const deployment = {
  factory: "0x6a1505b412e934f6f57f6b8eedcd68c7c8acb276",
  accountImplementation: "0x281476444a4b1c4ee019b2417539a8efc4af7930",
  configHash: "0x7b702db55819b2adba4fc4406aed1150d7f437400936406ce9153cc8668e6701",
};
assert.equal(accountAddressOf(deployment, 1n, 2n), "0x4f8222091Abf79FfDD74a7aDFcD80B24DdaB4804");
console.log("sign-in helpers: ok");

// A synthetic passkey assertion, as a browser returns it, proven and verified.
const bytes = buffer => new Uint8Array(buffer);
const sha256 = data => bytes(createHash("sha256").update(data).digest());
const { privateKey, publicKey: key } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicKey = publicKeyFromSpki(bytes(key.export({ type: "spki", format: "der" })));
const rpIdHash = sha256("verakey.test");
const authenticatorData = bytes(Buffer.concat([rpIdHash, Buffer.from([0x1d]), Buffer.alloc(4)]));
const challenge = randomBytes(32).toString("base64url");
const clientDataJSON = bytes(Buffer.from('{"type":"webauthn.get","challenge":"' + challenge + '","origin":"https://verakey.test","crossOrigin":false}'));
const signed = Buffer.concat([authenticatorData, sha256(clientDataJSON)]);
const signature = normalizeLowS(bytes(sign("sha256", signed, { key: privateKey, dsaEncoding: "ieee-p1363" })));
const prfSecret = bytes(randomBytes(32));
const appId = appIdFromName("package-check");

const prover = await VeraKeyProver.create({ threads: 4 });
try {
  const nullifier = await computeNullifier(prover.barretenberg, publicKey, prfSecret, appId);
  const proof = await prover.prove({ publicKey, signature, authenticatorData, prfSecret, clientDataJSON, rpIdHash, appId, nullifier });
  assert.equal(await prover.verify(proof), true, "the proof verifies");
  assert.equal(BigInt(proof.publicInputs[4]), appId);
  assert.equal(BigInt(proof.publicInputs[5]), nullifier);
  console.log("prover: a real proof in " + proof.provingMs + " ms, verified");
} finally {
  await prover.destroy();
}
`;

// Compiles in the fresh project. Each @ts-expect-error fails the build if an export resolves to \`any\`.
const TYPES_CHECK = `
import { appIdFromName, VeraKeyClient, VeraKeyProver } from "@verakey/sdk";
import { VeraKeyError, type ProofState } from "@verakey/sdk/client";
import { VeraKeyConnect, VeraKeyConnectError } from "@verakey/sdk/connect";
import { appIdFromOrigin, verifySignIn, type SignInResult } from "@verakey/sdk/signin";

const appId: bigint = appIdFromOrigin("https://game.example");
// @ts-expect-error appIdFromOrigin returns a bigint
const notAString: string = appIdFromOrigin("https://game.example");
// @ts-expect-error appIdFromName takes a string
appIdFromName(1);
declare const result: SignInResult;
// @ts-expect-error the account is an address
const notANumber: number = result.account;
const verified: Promise<unknown> = verifySignIn(result, {} as Parameters<typeof verifySignIn>[1]);
// @ts-expect-error verifySignIn needs its options
verifySignIn(result);
const connect = new VeraKeyConnect({ url: "https://verakey.mdloglabs.org" });
// @ts-expect-error signIn is a method
connect.signIn = 1;
declare const state: ProofState;
const status: string = state.status;
const classes = [VeraKeyError, VeraKeyConnectError, VeraKeyClient, VeraKeyProver];
export { appId, notAString, notANumber, verified, status, classes };
`;

// A page that signs players in, as a third-party site builds it.
const PAGE = `
import { VeraKeyConnect } from "@verakey/sdk/connect";
import { signInChallenge } from "@verakey/sdk/signin";
export const connect = new VeraKeyConnect({ url: "https://verakey.mdloglabs.org" });
export { signInChallenge };
`;

await main();
