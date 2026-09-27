// A ZeroDev Kernel v3.3 account on Arbitrum Sepolia whose owner is a VeraKey passkey: VeraKeyValidator (ERC-7579)
// validates each user operation with an UltraHonk proof that the passkey signed its userOpHash. The chain never sees
// the passkey's public key or signature.
//
//   node --env-file=.env --import tsx packages/sdk/scripts/kernel-sepolia.mts [--dry-run]
//
// Run it from the repository root. It
//   1. makes a passkey for this run: a software P-256 key and PRF secret, as in the validator's Foundry fixtures
//      (a browser passkey signs the same WebAuthn assertion);
//   2. builds the account with ZeroDev's SDK (createKernelAccount, VeraKey's plugin as its sudo validator);
//   3. funds it from the relayer: ETH for EntryPoint's prefund and 1 USDG;
//   4. signs one user operation, a 1 USDG payment to the demo merchant, by proving the passkey's assertion;
//   5. submits it with the relayer's key as the bundler (EntryPoint.handleOps) and checks what happened.
// --dry-run proves and simulates the same operation, paying 0 USDG, with the account's ETH balance overridden
// in the simulation; it sends nothing.
//
// Needs RELAYER_PRIVATE_KEY (Sepolia ETH, and USDG unless --dry-run). Nothing secret is printed.
import { readFileSync } from "node:fs";
import { p256 } from "@noble/curves/p256";
import { createKernelAccount } from "@zerodev/sdk";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseAbi,
  parseEther,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { entryPoint07Abi, toPackedUserOperation, type UserOperation } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import {
  appIdFromName,
  base64UrlEncode,
  bytesToHex,
  computeNullifier,
  concatBytes,
  hexToBytes,
  normalizeLowS,
  toFieldHex,
  verifyPasskeySignature,
  webauthnDigest,
  type PasskeyPublicKey,
} from "../src";
import { ENTRY_POINT_07, toVeraKeyKernelValidator } from "../src/kernel";
import { VeraKeyProver } from "../src/prover";

const DRY_RUN = process.argv.includes("--dry-run");
const deployment = JSON.parse(readFileSync("deployments/sepolia.json", "utf8"));
const { usdg, veraKeyValidator } = deployment.contracts as Record<string, Address>;
const APP_NAME = "kernel";
const PAYMENT = DRY_RUN ? 0n : 1_000_000n; // 1 USDG
const PREFUND = parseEther("0.0004");
const explorer = (kind: "tx" | "address", id: string) => `https://arbitrum-sepolia.blockscout.com/${kind}/${id}`;

const key = process.env.RELAYER_PRIVATE_KEY?.trim().replace(/^"|"$/g, "");
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("RELAYER_PRIVATE_KEY is missing or malformed (run with --env-file=.env)");
const relayer = privateKeyToAccount(key as Hex);
/** The demo merchant is the relayer, so the USDG goes back to the faucet treasury. */
const merchant = relayer.address;

const chain = defineChain({
  id: deployment.chainId,
  name: "Arbitrum Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [deployment.rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = createWalletClient({ chain, transport: http(), account: relayer });

// 1. The passkey for this run and its owner id in the app.
const utf8 = (text: string) => new TextEncoder().encode(text);
const privateKey = p256.utils.randomPrivateKey();
const uncompressed = p256.getPublicKey(privateKey, false);
const publicKey: PasskeyPublicKey = { x: uncompressed.slice(1, 33), y: uncompressed.slice(33, 65) };
const prfSecret = crypto.getRandomValues(new Uint8Array(32));
const appId = appIdFromName(APP_NAME);
const rpIdHash = hexToBytes(deployment.rpIdHash as Hex);
// Synced-passkey authenticator data: rpIdHash, flags UP|UV|BE|BS (0x1d), signCount 0.
const authenticatorData = concatBytes(rpIdHash, new Uint8Array([0x1d]), new Uint8Array(4));

const prover = await VeraKeyProver.create();
try {
  const nullifier = await computeNullifier(prover.barretenberg, publicKey, prfSecret, appId);
  let provingMs = 0;

  /** What a browser does for this challenge: the passkey signs the assertion, then the prover proves it. */
  const prove = async (challenge: Hex) => {
    const clientDataJSON = utf8(
      `{"type":"webauthn.get","challenge":"${base64UrlEncode(hexToBytes(challenge))}","origin":"${deployment.origin}","crossOrigin":false}`
    );
    const digest = await webauthnDigest(authenticatorData, clientDataJSON);
    const signature = normalizeLowS(p256.sign(digest, privateKey, { lowS: true }).toCompactRawBytes());
    if (!verifyPasskeySignature(publicKey, digest, signature)) throw new Error("the passkey's signature does not verify");
    const proof = await prover.prove({ publicKey, signature, authenticatorData, prfSecret, clientDataJSON, rpIdHash, appId, nullifier });
    provingMs = proof.provingMs;
    return { proof: proof.proof, clientDataJSON: bytesToHex(clientDataJSON) };
  };

  // 2. The Kernel account, with VeraKey's plugin as its sudo (root) validator.
  const validator = toVeraKeyKernelValidator({
    validator: veraKeyValidator,
    chainId: chain.id,
    appId: toFieldHex(appId),
    nullifier: toFieldHex(nullifier),
    prove,
    supportedKernelVersions: KERNEL_V3_3,
  });
  const kernel = await createKernelAccount(publicClient, {
    entryPoint: getEntryPoint("0.7"),
    kernelVersion: KERNEL_V3_3,
    plugins: { sudo: validator as never },
  });
  console.log(`Kernel v3.3 account ${kernel.address} (app "${APP_NAME}", owner nullifier ${toFieldHex(nullifier).slice(0, 10)}…)`);

  // 3. Funding, unless this is a dry run.
  if (!DRY_RUN) {
    const fund = async (label: string, send: () => Promise<Hex>) => {
      const hash = await send();
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`${label} failed: ${hash}`);
      console.log(`funded ${label}: ${explorer("tx", hash)}`);
    };
    await fund(`${formatEther(PREFUND)} ETH`, () => walletClient.sendTransaction({ to: kernel.address, value: PREFUND }));
    await fund(`${formatUnits(PAYMENT, 6)} USDG`, () =>
      walletClient.writeContract({ address: usdg, abi: erc20Abi, functionName: "transfer", args: [kernel.address, PAYMENT] })
    );
  }

  // 4. The user operation: deploy the account (first use) and pay the merchant.
  const gasPrice = await publicClient.getGasPrice();
  const factoryArgs = await kernel.getFactoryArgs();
  const userOperation: UserOperation<"0.7"> = {
    sender: kernel.address,
    nonce: await kernel.getNonce(),
    ...(factoryArgs.factory ? { factory: factoryArgs.factory, factoryData: factoryArgs.factoryData } : {}),
    callData: await kernel.encodeCalls([
      { to: usdg, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [merchant, PAYMENT] }) },
    ]),
    callGasLimit: 250_000n,
    // The proof costs about 732k gas inside VeraKeyValidator; the account's deployment and Kernel's own checks add the rest.
    verificationGasLimit: 1_700_000n,
    preVerificationGas: 150_000n,
    maxFeePerGas: gasPrice * 2n,
    maxPriorityFeePerGas: 0n,
    signature: "0x",
  };
  userOperation.signature = await kernel.signUserOperation({ ...userOperation, chainId: chain.id });
  console.log(`signed: the passkey's assertion over the userOpHash, proven in ${(provingMs / 1000).toFixed(1)} s (${(userOperation.signature.length - 2) / 2}-byte signature)`);

  // 5. The relayer bundles it.
  const handleOps = {
    account: relayer,
    address: ENTRY_POINT_07,
    abi: entryPoint07Abi,
    functionName: "handleOps",
    args: [[toPackedUserOperation(userOperation)], relayer.address],
  } as const;
  if (DRY_RUN) {
    await publicClient.simulateContract({ ...handleOps, stateOverride: [{ address: kernel.address, balance: parseEther("0.01") }] });
    console.log("dry run: EntryPoint.handleOps simulates without error (the proof was verified in the simulation); nothing was sent");
  } else {
    const { request } = await publicClient.simulateContract(handleOps);
    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const [event] = parseEventLogs({ abi: entryPoint07Abi, eventName: "UserOperationEvent", logs: receipt.logs });
    const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).filter(log => log.args.from === kernel.address);
    const installed = await publicClient.readContract({
      address: veraKeyValidator,
      abi: parseAbi(["function isInitialized(address) view returns (bool)"]),
      functionName: "isInitialized",
      args: [kernel.address],
    });
    console.log(`handleOps ${explorer("tx", hash)} — ${receipt.status}, ${receipt.gasUsed} gas`);
    console.log(`user operation: ${event?.args.success ? "succeeded" : "FAILED"}, ${event?.args.actualGasUsed} gas`);
    for (const t of transfers) console.log(`paid ${formatUnits(t.args.value, 6)} USDG to ${t.args.to}`);
    console.log(`VeraKeyValidator installed for the account: ${installed} — ${explorer("address", kernel.address)}`);
    if (receipt.status !== "success" || !event?.args.success || !installed) process.exitCode = 1;
  }
} finally {
  await prover.destroy();
}
