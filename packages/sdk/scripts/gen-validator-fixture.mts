// Writes contracts/evm/test/fixtures/validator-proof.json for the VeraKeyValidator Foundry tests.
// Each entry holds a real UltraHonk proof (bb.js 5.2.0, EVM transcript) of a WebAuthn assertion.
// These are the same proofs the browser makes for the Stylus account.
//
//   node --import tsx packages/sdk/scripts/gen-validator-fixture.mts [output.json]
//
// Run it from the repository root. The passkey private key and the PRF secret are fixed public test
// values, and ECDSA signing is deterministic (RFC 6979). A rerun therefore changes only the proofs,
// which are randomized by UltraHonk's zero-knowledge masking.
//
// Every entry is signed by the same passkey and proven against the same rpIdHash, appId and nullifier.
// User operations (challenge = userOpHash):
//   - top level:    Level 3 serialization with "crossOrigin":false (what browsers send). Must pass.
//   - level1:       no crossOrigin key, so `}` follows the origin directly. Must pass.
//   - crossOrigin:  "crossOrigin":true, i.e. asserted inside a cross-origin iframe. Must fail.
//   - wrongOrigin:  a subdomain origin, which WebAuthn lets use the same rpId. Must fail.
//   - prefixOrigin: the configured origin plus a port, so the configured origin is a byte prefix.
//                   Must fail.
// The failing variants carry valid proofs. A test can therefore show that the validator's
// clientDataJSON checks reject them, not the verifier.
// ERC-1271:
//   - erc1271: a signature over `erc1271.hash` for `erc1271.account` on chain `erc1271.chainId`
//     (Foundry's default). The passkey signs VeraKeyValidator.erc1271Challenge(account, hash), which
//     is keccak256(abi.encode(ERC1271_TYPEHASH, chainId, account, hash)), not the hash itself.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { p256 } from "@noble/curves/p256";
import { encodeAbiParameters, getAddress, keccak256, toBytes } from "viem";
import {
  BN254_R,
  appIdFromName,
  base64UrlEncode,
  bytesToHex,
  computeNullifier,
  concatBytes,
  hexToBytes,
  normalizeLowS,
  sha256,
  toFieldHex,
  verifyPasskeySignature,
  webauthnDigest,
  type PasskeyPublicKey,
} from "../src";
import { VeraKeyProver } from "../src/prover";

const RP_ID = "verakey.test";
const ORIGIN = "https://verakey.test";
const APP_NAME = "pay";
/** The account the Foundry tests prank for ERC-1271, and Foundry's default chain id. */
const ERC1271_ACCOUNT = getAddress("0x00000000000000000000000000000000000a11ce");
const ERC1271_CHAIN_ID = 31337n;
/** Must equal VeraKeyValidator.ERC1271_TYPEHASH. */
const ERC1271_TYPEHASH = keccak256(toBytes("VeraKeyERC1271(uint256 chainId,address account,bytes32 hash)"));

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.argv[2] ?? resolve(here, "../../../contracts/evm/test/fixtures/validator-proof.json"));

const utf8 = (text: string) => new TextEncoder().encode(text);
/** Fixed 32-byte test values. They are public, so never reuse them outside this fixture. */
const label = (name: string) => sha256(utf8(`verakey.validator-fixture:${name}`));

const privateKey = await label("passkey");
const uncompressed = p256.getPublicKey(privateKey, false);
const publicKey: PasskeyPublicKey = { x: uncompressed.slice(1, 33), y: uncompressed.slice(33, 65) };
const prfSecret = await label("prf");
const otherPrfSecret = await label("prf-other");
/** The user operation challenge: the value EntryPoint.getUserOpHash would return for some operation. */
const userOpHash = await label("userOpHash");
/** The digest an app asks the account to sign through ERC-1271 (e.g. an EIP-712 hash). */
const erc1271Hash = await label("erc1271Hash");
const erc1271Challenge = keccak256(
  encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }],
    [ERC1271_TYPEHASH, ERC1271_CHAIN_ID, ERC1271_ACCOUNT, bytesToHex(erc1271Hash)]
  )
);

const rpIdHash = await sha256(utf8(RP_ID));
// Synced-passkey authenticator data: rpIdHash, flags UP|UV|BE|BS (0x1d), signCount 0.
const authenticatorData = concatBytes(rpIdHash, new Uint8Array([0x1d]), new Uint8Array(4));
const appId = appIdFromName(APP_NAME);
const otherAppId = appIdFromName("other");

const clientData = (challenge: Uint8Array, origin: string, rest: string) =>
  `{"type":"webauthn.get","challenge":"${base64UrlEncode(challenge)}","origin":"${origin}"${rest}}`;

const prover = await VeraKeyProver.create();
try {
  const nullifier = await computeNullifier(prover.barretenberg, publicKey, prfSecret, appId);
  // The same app's nullifier for another PRF secret, i.e. another passkey's owner id.
  const otherNullifier = await computeNullifier(prover.barretenberg, publicKey, otherPrfSecret, appId);
  if (nullifier === otherNullifier || nullifier >= BN254_R || otherNullifier >= BN254_R) {
    throw new Error("unexpected nullifiers");
  }

  const prove = async (text: string) => {
    const clientDataJSON = utf8(text);
    const digest = await webauthnDigest(authenticatorData, clientDataJSON);
    const signature = normalizeLowS(p256.sign(digest, privateKey, { lowS: true }).toCompactRawBytes());
    if (!verifyPasskeySignature(publicKey, digest, signature)) throw new Error("bad test signature");
    const proof = await prover.prove({
      publicKey,
      signature,
      authenticatorData,
      prfSecret,
      clientDataJSON,
      rpIdHash,
      appId,
      nullifier,
    });
    if (!(await prover.verify(proof))) throw new Error(`bb.js rejected its own proof for ${text}`);
    if (proof.publicInputs[4] !== toFieldHex(appId) || proof.publicInputs[5] !== toFieldHex(nullifier)) {
      throw new Error("unexpected public inputs");
    }
    console.log(`proved ${text.length}-byte clientDataJSON in ${proof.provingMs} ms`);
    return {
      clientDataJSONText: text,
      clientDataJSON: bytesToHex(clientDataJSON),
      proof: proof.proof,
      publicInputs: proof.publicInputs,
    };
  };

  const valid = await prove(clientData(userOpHash, ORIGIN, `,"crossOrigin":false`));
  const variants: Record<string, Awaited<ReturnType<typeof prove>>> = {
    level1: await prove(clientData(userOpHash, ORIGIN, "")),
    crossOrigin: await prove(clientData(userOpHash, ORIGIN, `,"crossOrigin":true,"topOrigin":"https://evil.test"`)),
    wrongOrigin: await prove(clientData(userOpHash, "https://evil.verakey.test", `,"crossOrigin":false`)),
    prefixOrigin: await prove(clientData(userOpHash, `${ORIGIN}:8443`, `,"crossOrigin":false`)),
  };
  const erc1271 = await prove(clientData(hexToBytes(erc1271Challenge), ORIGIN, `,"crossOrigin":false`));

  const fixture = {
    comment:
      "GENERATED by packages/sdk/scripts/gen-validator-fixture.mts. Do not edit by hand. Real UltraHonk proofs (bb.js 5.2.0, EVM target) of WebAuthn assertions by a public test passkey. The top-level entry and variants.level1 validate as user operations; erc1271 validates through isValidSignatureWithSender for erc1271.account on chain erc1271.chainId.",
    rpId: RP_ID,
    rpIdHash: bytesToHex(rpIdHash),
    origin: ORIGIN,
    appId: toFieldHex(appId),
    otherAppId: toFieldHex(otherAppId),
    nullifier: toFieldHex(nullifier),
    otherNullifier: toFieldHex(otherNullifier),
    userOpHash: bytesToHex(userOpHash),
    ...valid,
    variants,
    erc1271: {
      account: ERC1271_ACCOUNT,
      chainId: Number(ERC1271_CHAIN_ID),
      typehash: ERC1271_TYPEHASH,
      hash: bytesToHex(erc1271Hash),
      challenge: erc1271Challenge,
      ...erc1271,
    },
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${output} (${(valid.proof.length - 2) / 2}-byte proofs)`);
} finally {
  await prover.destroy();
}
