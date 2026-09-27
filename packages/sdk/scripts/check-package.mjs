// Packs @verakey/sdk the way it is published, then checks the tarball from a fresh project outside
// the workspace:
//   1. the manifest points every module at built files in the tarball, which ships no source or tests;
//   2. Node imports it: the sign-in helpers compute a known account address, and the prover makes and
//      verifies a real proof of a synthetic passkey assertion;
//   3. TypeScript resolves typed exports, with moduleResolution bundler and nodenext;
//   4. a bundler builds a page that uses Sign in with VeraKey without pulling in the prover;
//   5. the integration kit: its server routes run in Node, the React module is marked "use client" and renders on
//      a server, React is an optional peer, and a React page bundles neither the prover nor the server.
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
    // Next.js treats the React module as client code only when the file starts with the directive.
    const reactModule = run("tar", ["-xzOf", tarball, "package/dist/react.js"], work);
    assert.ok(reactModule.startsWith('"use client";'), 'dist/react.js starts with "use client"');
    assert.deepEqual(manifest.peerDependencies, { react: ">=18" }, "React is a peer dependency");
    assert.deepEqual(manifest.peerDependenciesMeta, { react: { optional: true } }, "an optional one");

    step("install in a fresh project");
    writeFileSync(join(work, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
    run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", tarball], work, "inherit");
    // The integration kit's React module needs React; sites without React never install it.
    run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", "react@19", "react-dom@19", "@types/react@19"], work, "inherit");

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
    step("bundler: a React page with the kit leaves the prover and the server out");
    writeFileSync(join(work, "react-page.js"), REACT_PAGE);
    const reactOut = join(work, "react-page-dist");
    await build({
      root: work, configFile: false, logLevel: "warn",
      build: {
        outDir: reactOut, emptyOutDir: true,
        lib: { entry: join(work, "react-page.js"), formats: ["es"], fileName: "react-page" },
        rollupOptions: { external: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"] },
      },
    });
    const reactCode = readdirSync(reactOut).map(name => readFileSync(join(reactOut, name), "latin1")).join("\n");
    assert.doesNotMatch(reactCode, /barretenberg|noir_js|acvm/i, "no prover code");
    // The server's cookie MAC inputs exist only in its code; its name alone also appears in doc comments.
    assert.doesNotMatch(reactCode, /verakey-session\||verakey-nonce\|/, "no server code");
    assert.ok(reactCode.length < 300_000, `the page stays small (${reactCode.length} bytes)`);
    console.log(`React page: ${(reactCode.length / 1024).toFixed(0)} KB of kit code, no prover, no server`);

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
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ARBITRUM_SEPOLIA } from "@verakey/sdk/deployments";
import { SignInWithVeraKey, VeraKeyProvider } from "@verakey/sdk/react";
import { createVeraKeyServer } from "@verakey/sdk/server";
import { VeraKeySession } from "@verakey/sdk/session";

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
// The integration kit: the server's routes run in Node, the root leaves React out, and the button renders on a server.
for (const name of ["createVeraKeyServer", "VeraKeySession"]) assert.equal(typeof root[name], "function", "the root exports " + name);
assert.equal(root.ARBITRUM_SEPOLIA.chainId, 421614);
assert.equal(root.SignInWithVeraKey, undefined, "the root leaves React out");
const kit = createVeraKeyServer({ origin: "https://game.example", deployment: ARBITRUM_SEPOLIA, secret: "a secret of at least thirty-two bytes" });
const issued = await kit.handle(new Request("https://game.example/api/verakey/nonce", { method: "POST", headers: { origin: "https://game.example" } }));
assert.equal(issued.status, 200);
assert.match(issued.headers.getSetCookie()[0], /^__Host-verakey-nonce=0x[0-9a-f]{64}\\./);
assert.equal(typeof VeraKeySession, "function");
assert.match(renderToString(createElement(VeraKeyProvider, null, createElement(SignInWithVeraKey))), /Sign in with VeraKey/);
console.log("integration kit: server routes, session and React button: ok");

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
import { ARBITRUM_SEPOLIA, type VeraKeyDeployment } from "@verakey/sdk/deployments";
import { SignInWithVeraKey, useVeraKey, VeraKeyProvider } from "@verakey/sdk/react";
import { createVeraKeyServer, toExpress } from "@verakey/sdk/server";
import { VeraKeySession, VeraKeySessionError } from "@verakey/sdk/session";

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
const connect = new VeraKeyConnect({ url: "https://verakey.xyz" });
// @ts-expect-error signIn is a method
connect.signIn = 1;
declare const state: ProofState;
const status: string = state.status;
const classes = [VeraKeyError, VeraKeyConnectError, VeraKeyClient, VeraKeyProver];
const pinned: VeraKeyDeployment = ARBITRUM_SEPOLIA;
const kit = createVeraKeyServer({ origin: "https://game.example", deployment: ARBITRUM_SEPOLIA, secret: "s".repeat(32) });
// @ts-expect-error the kit needs a secret
createVeraKeyServer({ origin: "https://game.example", deployment: ARBITRUM_SEPOLIA });
const handled: Promise<Response> = kit.handle(new Request("https://game.example/api/verakey/session"));
const express = toExpress(kit);
declare const hook: ReturnType<typeof useVeraKey>;
const kitStatus: string = hook.status;
// @ts-expect-error pay takes a bigint amount
hook.pay({ amount: 1 });
const kitParts = [VeraKeyProvider, SignInWithVeraKey, VeraKeySession, VeraKeySessionError];
export { pinned, handled, express, kitStatus, kitParts };
export { appId, notAString, notANumber, verified, status, classes };
`;

// A page that signs players in, as a third-party site builds it.
const PAGE = `
import { VeraKeyConnect } from "@verakey/sdk/connect";
import { signInChallenge } from "@verakey/sdk/signin";
export const connect = new VeraKeyConnect({ url: "https://verakey.xyz" });
export { signInChallenge };
`;

// A React page with the kit's button, as a third-party site builds it.
const REACT_PAGE = `
import { createElement } from "react";
import { SignInWithVeraKey, VeraKeyProvider } from "@verakey/sdk/react";
export const app = createElement(VeraKeyProvider, null, createElement(SignInWithVeraKey));
`;

await main();
