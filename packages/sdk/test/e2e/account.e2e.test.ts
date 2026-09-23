// End-to-end tests against real contracts on a local nitro devnode (ArbOS 61), with real
// UltraHonk proofs from virtual passkeys. Test names follow docs/PRD.md §7c.
//
//   scripts/deploy.sh local && pnpm --filter @verakey/sdk test:e2e
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeFunctionData, keccak256, parseEventLogs, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ActionKind,
  VeraKeyProver,
  ZERO_HASH,
  appIdFromName,
  changeDataHash,
  changePayload,
  computeNullifier,
  erc20Abi,
  guardianCommitment,
  veraKeyAccountAbi,
  veraKeyFactoryAbi,
} from "../../src";
import {
  USDG,
  VirtualPasskey,
  authorize,
  chainNow,
  deployment,
  devAccount,
  fieldHex,
  publicClient,
  revertName,
  waitForChainTime,
  walletFor,
  type Owner,
} from "./harness";

const { factory, factoryAlt, usdg, accountImplementation } = deployment.contracts;
const relayer = walletFor(devAccount);
const recipient = privateKeyToAccount(generatePrivateKey()).address;
const FEE = USDG(0.01);

const now = () => BigInt(Math.floor(Date.now() / 1000));
const deadline = (seconds = 300) => now() + BigInt(seconds);
const sleepUntil = (eta: bigint) => waitForChainTime(eta);

let prover: VeraKeyProver;
const apps = { pay: appIdFromName("pay"), vault: appIdFromName("vault"), tip: appIdFromName("tip") };
const accounts = {} as Record<keyof typeof apps, Address>;
const owners = {} as Record<keyof typeof apps, Owner>;
let passkey: VirtualPasskey;
const gas: Record<string, bigint> = {};

async function createAccount(appId: bigint, nullifier: bigint): Promise<Address> {
  const { request, result } = await publicClient.simulateContract({
    address: factory,
    abi: veraKeyFactoryAbi,
    functionName: "createAccount",
    args: [fieldHex(appId), fieldHex(nullifier)],
    account: devAccount,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: await relayer.writeContract(request) });
  gas.createAccount = receipt.gasUsed;
  return result;
}

async function payArgs(owner: Owner, appId: bigint, account: Address, to: Address, amount: bigint, extra = {}) {
  const auth = await authorize(prover, owner, appId, account, {
    kind: ActionKind.Pay,
    target: to,
    amount,
    dataHash: ZERO_HASH,
    fee: FEE,
    deadline: deadline(),
    ...extra,
  });
  return auth;
}

function payCall(account: Address, owner: Owner, to: Address, amount: bigint, auth: { clientDataJSON: Hex; proof: Hex }, dl: bigint) {
  return {
    address: account,
    abi: veraKeyAccountAbi,
    functionName: "pay" as const,
    args: [to, amount, FEE, dl, fieldHex(owner.nullifier), auth.clientDataJSON, auth.proof] as const,
    account: devAccount,
  };
}

/** Builds, proves and submits a payment; returns the receipt. */
async function pay(owner: Owner, appId: bigint, account: Address, to: Address, amount: bigint, submitter = relayer) {
  const dl = deadline();
  const auth = await authorize(prover, owner, appId, account, {
    kind: ActionKind.Pay, target: to, amount, dataHash: ZERO_HASH, fee: FEE, deadline: dl,
  });
  const { request } = await publicClient.simulateContract({ ...payCall(account, owner, to, amount, auth, dl), account: submitter.account });
  const hash = await submitter.writeContract(request);
  return { receipt: await publicClient.waitForTransactionReceipt({ hash }), auth };
}

async function schedule(owner: Owner, appId: bigint, account: Address, change: { kind: number; payload: Hex }) {
  const dl = deadline();
  const auth = await authorize(prover, owner, appId, account, {
    kind: ActionKind.ScheduleChange,
    target: "0x0000000000000000000000000000000000000000",
    amount: 0n,
    dataHash: changeDataHash(change.kind as never, change.payload),
    fee: FEE,
    deadline: dl,
  });
  const { request } = await publicClient.simulateContract({
    address: account,
    abi: veraKeyAccountAbi,
    functionName: "scheduleChange",
    args: [change.kind, change.payload, FEE, dl, fieldHex(owner.nullifier), auth.clientDataJSON, auth.proof],
    account: devAccount,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: await relayer.writeContract(request) });
  const [event] = parseEventLogs({ abi: veraKeyAccountAbi, eventName: "ChangeScheduled", logs: receipt.logs });
  return { changeId: event.args.changeId, eta: event.args.eta, hash: receipt.transactionHash };
}

/** Signs and proves a tightening change; returns the simulation request (throws on revert). */
async function restrictRequest(owner: Owner, appId: bigint, account: Address, change: { kind: number; payload: Hex }, signed = change) {
  const dl = deadline();
  const auth = await authorize(prover, owner, appId, account, {
    kind: ActionKind.Restrict,
    target: "0x0000000000000000000000000000000000000000",
    amount: 0n,
    dataHash: changeDataHash(signed.kind as never, signed.payload),
    fee: FEE,
    deadline: dl,
  });
  return publicClient.simulateContract({
    address: account,
    abi: veraKeyAccountAbi,
    functionName: "restrict",
    args: [change.kind, change.payload, FEE, dl, fieldHex(owner.nullifier), auth.clientDataJSON, auth.proof],
    account: devAccount,
  });
}

async function restrict(owner: Owner, appId: bigint, account: Address, change: { kind: number; payload: Hex }) {
  const { request } = await restrictRequest(owner, appId, account, change);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: await relayer.writeContract(request) });
  gas.restrict = receipt.gasUsed;
  return receipt;
}

const protections = (account: Address) =>
  publicClient.readContract({ address: account, abi: veraKeyAccountAbi, functionName: "protections" });

async function apply(account: Address, changeId: Hex, change: { kind: number; payload: Hex }) {
  const { request } = await publicClient.simulateContract({
    address: account, abi: veraKeyAccountAbi, functionName: "applyChange",
    args: [changeId, change.kind, change.payload], account: devAccount,
  });
  return publicClient.waitForTransactionReceipt({ hash: await relayer.writeContract(request) });
}

const balance = (who: Address) =>
  publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [who] });

beforeAll(async () => {
  prover = await VeraKeyProver.create({ threads: 8 });
  passkey = await VirtualPasskey.create();
  for (const name of Object.keys(apps) as (keyof typeof apps)[]) {
    const nullifier = await computeNullifier(prover.barretenberg, passkey.publicKey, passkey.prfSecret, apps[name]);
    owners[name] = { passkey, nullifier };
    accounts[name] = await createAccount(apps[name], nullifier);
  }
  const mint = await relayer.writeContract({
    address: usdg,
    abi: [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [] }],
    functionName: "mint",
    args: [accounts.pay, USDG(1000)],
  });
  await publicClient.waitForTransactionReceipt({ hash: mint });
}, 180_000);

afterAll(async () => {
  console.table(Object.fromEntries(Object.entries(gas).map(([k, v]) => [k, v.toString()])));
  await prover?.destroy();
});

describe("factory", () => {
  it("one_passkey_three_apps_have_distinct_accounts_and_nullifiers", async () => {
    const nullifiers = new Set(Object.values(owners).map(o => o.nullifier));
    const addresses = new Set(Object.values(accounts));
    expect(nullifiers.size).toBe(3);
    expect(addresses.size).toBe(3);
    for (const name of Object.keys(apps) as (keyof typeof apps)[]) {
      const predicted = await publicClient.readContract({
        address: factory, abi: veraKeyFactoryAbi, functionName: "accountAddress",
        args: [fieldHex(apps[name]), fieldHex(owners[name].nullifier)],
      });
      expect(predicted).toBe(accounts[name]);
      for (const other of Object.keys(apps) as (keyof typeof apps)[]) {
        const isOwner = await publicClient.readContract({
          address: accounts[name], abi: veraKeyAccountAbi, functionName: "isOwner",
          args: [fieldHex(owners[other].nullifier)],
        });
        expect(isOwner).toBe(name === other);
      }
    }
  });

  it("frontrun_with_other_verifier_gets_other_address", async () => {
    const args = [fieldHex(apps.pay), fieldHex(owners.pay.nullifier)] as const;
    const real = await publicClient.readContract({ address: factory, abi: veraKeyFactoryAbi, functionName: "accountAddress", args });
    const other = await publicClient.readContract({ address: factoryAlt, abi: veraKeyFactoryAbi, functionName: "accountAddress", args });
    expect(other).not.toBe(real);
  });

  it("create_account_is_idempotent", async () => {
    expect(await createAccount(apps.pay, owners.pay.nullifier)).toBe(accounts.pay);
  });

  it("init_twice_reverts", async () => {
    const name = await revertName(publicClient.simulateContract({
      address: accounts.pay, abi: veraKeyAccountAbi, functionName: "initialize",
      args: [fieldHex(apps.pay), fieldHex(1n), usdg, usdg, deployment.rpIdHash, toHex("x"), 1n, 1n, 0n, 0n, 0n],
      account: devAccount,
    }));
    expect(name).toBe("AlreadyInitialized");
  });

  it("views_decode_with_the_exported_abi", async () => {
    const [accountFactory, verifier, token, rpIdHash, changeDelay, recoveryDelay] = await publicClient.readContract({
      address: accounts.pay, abi: veraKeyAccountAbi, functionName: "config",
    });
    expect(accountFactory.toLowerCase()).toBe(factory.toLowerCase());
    expect(verifier.toLowerCase()).toBe(deployment.contracts.honkVerifier.toLowerCase());
    expect(token.toLowerCase()).toBe(usdg.toLowerCase());
    expect(rpIdHash).toBe(deployment.rpIdHash);
    expect(changeDelay).toBe(BigInt(deployment.policy.changeDelay));
    expect(recoveryDelay).toBe(BigInt(deployment.policy.recoveryDelay));
    const origin = await publicClient.readContract({ address: accounts.pay, abi: veraKeyAccountAbi, functionName: "origin" });
    expect(Buffer.from(origin.slice(2), "hex").toString()).toBe(deployment.origin);
    const factoryConfig = await publicClient.readContract({ address: factory, abi: veraKeyFactoryAbi, functionName: "config" });
    expect(factoryConfig[0].toLowerCase()).toBe(accountImplementation.toLowerCase());
    const [perTxCap, dailyCap, spent, , allowlist] = await publicClient.readContract({ address: accounts.vault, abi: veraKeyAccountAbi, functionName: "policy" });
    expect([perTxCap, dailyCap, spent, allowlist]).toEqual([BigInt(deployment.policy.perTxCap), BigInt(deployment.policy.dailyCap), 0n, false]);
    const [newPayeeCap, frozen, guardian] = await publicClient.readContract({ address: accounts.vault, abi: veraKeyAccountAbi, functionName: "protections" });
    expect([newPayeeCap, frozen, guardian]).toEqual([BigInt(deployment.policy.newPayeeCap), false, ZERO_HASH]);
  });

  it("implementation_is_locked", async () => {
    const name = await revertName(publicClient.simulateContract({
      address: accountImplementation, abi: veraKeyAccountAbi, functionName: "initialize",
      args: [fieldHex(apps.pay), fieldHex(1n), usdg, usdg, deployment.rpIdHash, toHex("x"), 1n, 1n, 0n, 0n, 0n],
      account: devAccount,
    }));
    expect(name).toBe("AlreadyInitialized");
  });
});

describe("pay", () => {
  it("pay_moves_usdg_and_pays_the_submitter", async () => {
    const before = { account: await balance(accounts.pay), to: await balance(recipient), relayer: await balance(devAccount.address) };
    const { receipt, auth } = await pay(owners.pay, apps.pay, accounts.pay, recipient, USDG(2));
    gas.pay = receipt.gasUsed;
    expect(receipt.status).toBe("success");
    expect(await balance(recipient)).toBe(before.to + USDG(2));
    expect(await balance(devAccount.address)).toBe(before.relayer + FEE);
    expect(await balance(accounts.pay)).toBe(before.account - USDG(2) - FEE);
    const [paid] = parseEventLogs({ abi: veraKeyAccountAbi, eventName: "Paid", logs: receipt.logs });
    expect(paid.args).toMatchObject({ nonce: 0n, to: recipient, amount: USDG(2), fee: FEE });
    console.log(`proving ${auth.provingMs} ms, pay gas ${receipt.gasUsed}`);
  });

  it("pubkey_absent_from_calldata", async () => {
    const { receipt } = await pay(owners.pay, apps.pay, accounts.pay, recipient, USDG(1));
    const tx = await publicClient.getTransaction({ hash: receipt.transactionHash });
    const input = tx.input.toLowerCase();
    for (const coordinate of [passkey.publicKey.x, passkey.publicKey.y]) {
      expect(input.includes(Buffer.from(coordinate).toString("hex"))).toBe(false);
    }
    expect(input.includes(Buffer.from(passkey.prfSecret).toString("hex"))).toBe(false);
  });

  it("replayed_proof_reverts", async () => {
    const dl = deadline();
    const auth = await payArgs(owners.pay, apps.pay, accounts.pay, recipient, USDG(1), { deadline: dl });
    const call = payCall(accounts.pay, owners.pay, recipient, USDG(1), auth, dl);
    const { request } = await publicClient.simulateContract(call);
    await publicClient.waitForTransactionReceipt({ hash: await relayer.writeContract(request) });
    expect(await revertName(publicClient.simulateContract(call))).toBe("InvalidClientData");
  });

  it("any_eoa_executes_and_gets_fee", async () => {
    const stranger = privateKeyToAccount(generatePrivateKey());
    await publicClient.waitForTransactionReceipt({
      hash: await relayer.sendTransaction({ to: stranger.address, value: 10n ** 16n }),
    });
    await pay(owners.pay, apps.pay, accounts.pay, recipient, USDG(1), walletFor(stranger));
    expect(await balance(stranger.address)).toBe(FEE);
  });

  it("chrome_injected_keys_accepted", async () => {
    const dl = deadline();
    const auth = await authorize(prover, owners.pay, apps.pay, accounts.pay,
      { kind: ActionKind.Pay, target: recipient, amount: USDG(1), dataHash: ZERO_HASH, fee: FEE, deadline: dl },
      { extraJson: ',"other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"' });
    const { request } = await publicClient.simulateContract(payCall(accounts.pay, owners.pay, recipient, USDG(1), auth, dl));
    const receipt = await publicClient.waitForTransactionReceipt({ hash: await relayer.writeContract(request) });
    expect(receipt.status).toBe("success");
  });
});

describe("authorization binding", () => {
  const signed = async (sign: Parameters<typeof authorize>[5], overrides: Partial<{ nullifier: bigint }> = {}) => {
    const dl = deadline();
    const auth = await authorize(prover, owners.pay, apps.pay, accounts.pay,
      { kind: ActionKind.Pay, target: recipient, amount: USDG(1), dataHash: ZERO_HASH, fee: FEE, deadline: dl }, sign);
    const owner = { ...owners.pay, ...overrides };
    return revertName(publicClient.simulateContract(payCall(accounts.pay, owner, recipient, USDG(1), auth, dl)));
  };

  it("wrong_origin_reverts", async () => {
    expect(await signed({ origin: "https://evil.example" })).toBe("InvalidClientData");
  });

  it("create_type_reverts", async () => {
    expect(await signed({ type: "webauthn.create" })).toBe("InvalidClientData");
  });

  it("proof_for_other_account_reverts", async () => {
    expect(await signed({ hashAccount: accounts.vault })).toBe("InvalidClientData");
  });

  it("proof_for_other_chain_reverts", async () => {
    expect(await signed({ chainId: 42161 })).toBe("InvalidClientData");
  });

  it("not_owner_reverts", async () => {
    expect(await signed({}, { nullifier: owners.vault.nullifier })).toBe("NotOwner");
  });

  it("tampered_proof_reverts", async () => {
    const dl = deadline();
    const auth = await payArgs(owners.pay, apps.pay, accounts.pay, recipient, USDG(1), { deadline: dl });
    const bytes = Buffer.from(auth.proof.slice(2), "hex");
    bytes[200] ^= 1;
    const tampered = { ...auth, proof: `0x${bytes.toString("hex")}` as Hex };
    expect(await revertName(publicClient.simulateContract(payCall(accounts.pay, owners.pay, recipient, USDG(1), tampered, dl)))).toBe("InvalidProof");
  });

  it("expired_deadline_reverts", async () => {
    const dl = (await chainNow()) - 1n;
    const auth = await payArgs(owners.pay, apps.pay, accounts.pay, recipient, USDG(1), { deadline: dl });
    expect(await revertName(publicClient.simulateContract(payCall(accounts.pay, owners.pay, recipient, USDG(1), auth, dl)))).toBe("DeadlineExpired");
  });

  it("deadline_over_10_min_reverts", async () => {
    const dl = now() + 3600n;
    const auth = await payArgs(owners.pay, apps.pay, accounts.pay, recipient, USDG(1), { deadline: dl });
    expect(await revertName(publicClient.simulateContract(payCall(accounts.pay, owners.pay, recipient, USDG(1), auth, dl)))).toBe("DeadlineTooFar");
  });

  it("eth_value_reverts", async () => {
    const dl = deadline();
    const auth = await payArgs(owners.pay, apps.pay, accounts.pay, recipient, USDG(1), { deadline: dl });
    // viem forbids `value` on nonpayable functions at the type level; that is exactly what is under test.
    await expect(publicClient.simulateContract({ ...payCall(accounts.pay, owners.pay, recipient, USDG(1), auth, dl), value: 1n } as never)).rejects.toThrow();
  });

  it("no_generic_call_surface", async () => {
    const data = encodeFunctionData({
      abi: [{ type: "function", name: "execute", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }], outputs: [] }],
      functionName: "execute",
      args: [usdg, 0n, "0x095ea7b3"],
    });
    await expect(publicClient.call({ to: accounts.pay, data, account: devAccount })).rejects.toThrow();
  });
});

describe("policy", () => {
  it("over_tx_cap_reverts", async () => {
    const amount = BigInt(deployment.policy.perTxCap);
    const dl = deadline();
    const auth = await payArgs(owners.pay, apps.pay, accounts.pay, recipient, amount, { deadline: dl });
    expect(await revertName(publicClient.simulateContract(payCall(accounts.pay, owners.pay, recipient, amount, auth, dl)))).toBe("PerTxCapExceeded");
  });

  it("over_daily_cap_reverts", async () => {
    const perTx = BigInt(deployment.policy.perTxCap) - FEE;
    const [, dailyCap, spent] = await publicClient.readContract({ address: accounts.pay, abi: veraKeyAccountAbi, functionName: "policy" });
    let remaining = dailyCap - spent;
    while (remaining >= perTx + FEE) {
      await pay(owners.pay, apps.pay, accounts.pay, recipient, perTx);
      remaining -= perTx + FEE;
    }
    const dl = deadline();
    const auth = await payArgs(owners.pay, apps.pay, accounts.pay, recipient, perTx, { deadline: dl });
    expect(await revertName(publicClient.simulateContract(payCall(accounts.pay, owners.pay, recipient, perTx, auth, dl)))).toBe("DailyCapExceeded");
  });

  it("raise_cap_then_drain_within_timelock_reverts", async () => {
    const raise = changePayload.setLimits(USDG(500), USDG(5000));
    const { changeId, eta } = await schedule(owners.pay, apps.pay, accounts.pay, raise);
    // Still bound by the old caps while the change is pending.
    const amount = USDG(100);
    const dl = deadline();
    const auth = await payArgs(owners.pay, apps.pay, accounts.pay, recipient, amount, { deadline: dl });
    expect(await revertName(publicClient.simulateContract(payCall(accounts.pay, owners.pay, recipient, amount, auth, dl)))).toBe("PerTxCapExceeded");
    // apply_before_eta_reverts
    expect(await revertName(publicClient.simulateContract({
      address: accounts.pay, abi: veraKeyAccountAbi, functionName: "applyChange",
      args: [changeId, raise.kind, raise.payload], account: devAccount,
    }))).toBe("ChangeNotReady");
    await sleepUntil(eta);
    await apply(accounts.pay, changeId, raise);
    const receipt = (await pay(owners.pay, apps.pay, accounts.pay, recipient, amount)).receipt;
    expect(receipt.status).toBe("success");
  });

  it("cancelled_change_cannot_apply", async () => {
    const change = changePayload.setAllowlist(true);
    const { changeId } = await schedule(owners.pay, apps.pay, accounts.pay, change);
    const dl = deadline();
    const auth = await authorize(prover, owners.pay, apps.pay, accounts.pay, {
      kind: ActionKind.CancelChange, target: "0x0000000000000000000000000000000000000000", amount: 0n,
      dataHash: changeId, fee: FEE, deadline: dl,
    });
    const { request } = await publicClient.simulateContract({
      address: accounts.pay, abi: veraKeyAccountAbi, functionName: "cancelChange",
      args: [changeId, FEE, dl, fieldHex(owners.pay.nullifier), auth.clientDataJSON, auth.proof], account: devAccount,
    });
    await publicClient.waitForTransactionReceipt({ hash: await relayer.writeContract(request) });
    expect(await revertName(publicClient.simulateContract({
      address: accounts.pay, abi: veraKeyAccountAbi, functionName: "applyChange",
      args: [changeId, change.kind, change.payload], account: devAccount,
    }))).toBe("UnknownChange");
  });

  it("recipient_not_allowlisted_reverts", async () => {
    const allow = changePayload.setRecipient(recipient, true);
    const enable = changePayload.setAllowlist(true);
    const a = await schedule(owners.pay, apps.pay, accounts.pay, allow);
    const b = await schedule(owners.pay, apps.pay, accounts.pay, enable);
    await sleepUntil(b.eta);
    await apply(accounts.pay, a.changeId, allow);
    await apply(accounts.pay, b.changeId, enable);
    const stranger = privateKeyToAccount(generatePrivateKey()).address;
    const dl = deadline();
    const auth = await payArgs(owners.pay, apps.pay, accounts.pay, stranger, USDG(1), { deadline: dl });
    expect(await revertName(publicClient.simulateContract(payCall(accounts.pay, owners.pay, stranger, USDG(1), auth, dl)))).toBe("RecipientNotAllowed");
    expect((await pay(owners.pay, apps.pay, accounts.pay, recipient, USDG(1))).receipt.status).toBe("success");
  });
});

describe("owners and recovery", () => {
  let backup: Owner;
  let rescue: Owner;
  const guardian = privateKeyToAccount(generatePrivateKey());

  beforeAll(async () => {
    const backupKey = await VirtualPasskey.create();
    const rescueKey = await VirtualPasskey.create();
    backup = { passkey: backupKey, nullifier: await computeNullifier(prover.barretenberg, backupKey.publicKey, backupKey.prfSecret, apps.pay) };
    rescue = { passkey: rescueKey, nullifier: await computeNullifier(prover.barretenberg, rescueKey.publicKey, rescueKey.prfSecret, apps.pay) };
    await publicClient.waitForTransactionReceipt({ hash: await relayer.sendTransaction({ to: guardian.address, value: 10n ** 16n }) });
  });

  it("backup_passkey_can_pay_after_timelock", async () => {
    const add = changePayload.addOwner(fieldHex(backup.nullifier));
    const { changeId, eta } = await schedule(owners.pay, apps.pay, accounts.pay, add);
    await sleepUntil(eta);
    await apply(accounts.pay, changeId, add);
    expect((await pay(backup, apps.pay, accounts.pay, recipient, USDG(1))).receipt.status).toBe("success");
  });

  it("remove_last_owner_reverts", async () => {
    const removePrimary = changePayload.removeOwner(fieldHex(owners.pay.nullifier));
    const first = await schedule(backup, apps.pay, accounts.pay, removePrimary);
    await sleepUntil(first.eta);
    await apply(accounts.pay, first.changeId, removePrimary);
    const removeBackup = changePayload.removeOwner(fieldHex(backup.nullifier));
    const second = await schedule(backup, apps.pay, accounts.pay, removeBackup);
    await sleepUntil(second.eta);
    expect(await revertName(publicClient.simulateContract({
      address: accounts.pay, abi: veraKeyAccountAbi, functionName: "applyChange",
      args: [second.changeId, removeBackup.kind, removeBackup.payload], account: devAccount,
    }))).toBe("LastOwner");
  });

  it("guardian_recovery_rotates_owners_and_owner_can_cancel", async () => {
    const salt = keccak256(toHex("guardian salt for pay"));
    const setGuardian = changePayload.setGuardian(guardianCommitment(accounts.pay, guardian.address, salt));
    const s = await schedule(backup, apps.pay, accounts.pay, setGuardian);
    await sleepUntil(s.eta);
    await apply(accounts.pay, s.changeId, setGuardian);
    const guardianWallet = walletFor(guardian);
    const initiate = async () => {
      const { request } = await publicClient.simulateContract({
        address: accounts.pay, abi: veraKeyAccountAbi, functionName: "initiateRecovery",
        args: [fieldHex(rescue.nullifier), salt], account: guardian,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: await guardianWallet.writeContract(request) });
      return parseEventLogs({ abi: veraKeyAccountAbi, eventName: "RecoveryInitiated", logs: receipt.logs })[0].args.eta;
    };

    // The owner vetoes the first attempt with a proof.
    await initiate();
    const dl = deadline();
    const auth = await authorize(prover, backup, apps.pay, accounts.pay, {
      kind: ActionKind.CancelRecovery, target: "0x0000000000000000000000000000000000000000", amount: 0n,
      dataHash: fieldHex(rescue.nullifier), fee: FEE, deadline: dl,
    });
    const { request } = await publicClient.simulateContract({
      address: accounts.pay, abi: veraKeyAccountAbi, functionName: "cancelRecovery",
      args: [FEE, dl, fieldHex(backup.nullifier), auth.clientDataJSON, auth.proof], account: devAccount,
    });
    await publicClient.waitForTransactionReceipt({ hash: await relayer.writeContract(request) });
    expect((await publicClient.readContract({ address: accounts.pay, abi: veraKeyAccountAbi, functionName: "recovery" }))[1]).toBe(0n);

    // A change the old owner schedules before recovery must not survive it.
    const stale = changePayload.setLimits(USDG(1), USDG(1));
    const pending = await schedule(backup, apps.pay, accounts.pay, stale);

    const eta = await initiate();
    expect(await revertName(publicClient.simulateContract({
      address: accounts.pay, abi: veraKeyAccountAbi, functionName: "executeRecovery", account: devAccount,
    }))).toBe("RecoveryNotReady");
    await sleepUntil(eta > pending.eta ? eta : pending.eta);
    const { request: exec } = await publicClient.simulateContract({
      address: accounts.pay, abi: veraKeyAccountAbi, functionName: "executeRecovery", account: devAccount,
    });
    await publicClient.waitForTransactionReceipt({ hash: await relayer.writeContract(exec) });

    const dl2 = deadline();
    const oldAuth = await payArgs(backup, apps.pay, accounts.pay, recipient, USDG(1), { deadline: dl2 });
    expect(await revertName(publicClient.simulateContract(payCall(accounts.pay, backup, recipient, USDG(1), oldAuth, dl2)))).toBe("NotOwner");
    expect((await pay(rescue, apps.pay, accounts.pay, recipient, USDG(1))).receipt.status).toBe("success");
    expect(await revertName(publicClient.simulateContract({
      address: accounts.pay, abi: veraKeyAccountAbi, functionName: "applyChange",
      args: [pending.changeId, stale.kind, stale.payload], account: devAccount,
    }))).toBe("UnknownChange");
  });
});

describe("protections", () => {
  const cap = BigInt(deployment.policy.newPayeeCap);
  const stranger = privateKeyToAccount(generatePrivateKey()).address;
  const guardian = privateKeyToAccount(generatePrivateKey());
  const salt = keccak256(toHex("guardian salt for tip"));

  beforeAll(async () => {
    const mint = await relayer.writeContract({
      address: usdg,
      abi: [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [] }],
      functionName: "mint",
      args: [accounts.tip, USDG(200)],
    });
    await publicClient.waitForTransactionReceipt({ hash: mint });
    await publicClient.waitForTransactionReceipt({ hash: await relayer.sendTransaction({ to: guardian.address, value: 10n ** 16n }) });
  });

  it("new_payee_cap_bounds_the_first_payment_to_an_unknown_recipient", async () => {
    const dl = deadline();
    const auth = await payArgs(owners.tip, apps.tip, accounts.tip, stranger, cap + 1n, { deadline: dl });
    expect(await revertName(publicClient.simulateContract(payCall(accounts.tip, owners.tip, stranger, cap + 1n, auth, dl)))).toBe("NewPayeeCapExceeded");
    const first = await pay(owners.tip, apps.tip, accounts.tip, stranger, cap);
    gas.payFirstToNewRecipient = first.receipt.gasUsed;
    expect(await publicClient.readContract({ address: accounts.tip, abi: veraKeyAccountAbi, functionName: "isKnownRecipient", args: [stranger] })).toBe(true);
    // Once paid, the recipient is known and only the ordinary caps apply.
    const second = await pay(owners.tip, apps.tip, accounts.tip, stranger, cap + USDG(1));
    gas.payKnownRecipient = second.receipt.gasUsed;
    expect(second.receipt.status).toBe("success");
  });

  it("allowlisted_recipient_is_exempt_from_the_new_payee_cap", async () => {
    const friend = privateKeyToAccount(generatePrivateKey()).address;
    const allow = changePayload.setRecipient(friend, true);
    const scheduled = await schedule(owners.tip, apps.tip, accounts.tip, allow);
    await sleepUntil(scheduled.eta);
    await apply(accounts.tip, scheduled.changeId, allow);
    expect((await pay(owners.tip, apps.tip, accounts.tip, friend, cap + USDG(2))).receipt.status).toBe("success");
  });

  it("restrict_tightens_at_once_and_refuses_to_loosen", async () => {
    await restrict(owners.tip, apps.tip, accounts.tip, changePayload.setLimits(USDG(20), USDG(150)));
    const [perTx, daily] = await publicClient.readContract({ address: accounts.tip, abi: veraKeyAccountAbi, functionName: "policy" });
    expect([perTx, daily]).toEqual([USDG(20), USDG(150)]);
    expect(await revertName(restrictRequest(owners.tip, apps.tip, accounts.tip, changePayload.setLimits(USDG(21), USDG(150))))).toBe("NotRestrictive");
    expect(await revertName(restrictRequest(owners.tip, apps.tip, accounts.tip, changePayload.unfreeze()))).toBe("NotRestrictive");
    expect(await revertName(restrictRequest(owners.tip, apps.tip, accounts.tip, changePayload.addOwner(fieldHex(7n))))).toBe("NotRestrictive");
    // The proof binds the payload: a proof for one tightening cannot apply another.
    expect(await revertName(restrictRequest(owners.tip, apps.tip, accounts.tip,
      changePayload.setLimits(USDG(1), USDG(1)), changePayload.setLimits(USDG(10), USDG(100))))).toBe("InvalidClientData");
    await restrict(owners.tip, apps.tip, accounts.tip, changePayload.setNewPayeeCap(USDG(1)));
    expect((await protections(accounts.tip))[0]).toBe(USDG(1));
  });

  it("owner_freeze_stops_payments_until_a_timelocked_unfreeze", async () => {
    await restrict(owners.tip, apps.tip, accounts.tip, changePayload.freeze());
    expect((await protections(accounts.tip))[1]).toBe(true);
    const dl = deadline();
    const auth = await payArgs(owners.tip, apps.tip, accounts.tip, stranger, USDG(1), { deadline: dl });
    expect(await revertName(publicClient.simulateContract(payCall(accounts.tip, owners.tip, stranger, USDG(1), auth, dl)))).toBe("AccountFrozen");
    const unfreeze = changePayload.unfreeze();
    const scheduled = await schedule(owners.tip, apps.tip, accounts.tip, unfreeze);
    expect(await revertName(publicClient.simulateContract({
      address: accounts.tip, abi: veraKeyAccountAbi, functionName: "applyChange",
      args: [scheduled.changeId, unfreeze.kind, unfreeze.payload], account: devAccount,
    }))).toBe("ChangeNotReady");
    await sleepUntil(scheduled.eta);
    await apply(accounts.tip, scheduled.changeId, unfreeze);
    expect((await pay(owners.tip, apps.tip, accounts.tip, stranger, USDG(1))).receipt.status).toBe("success");
  });

  it("guardian_is_private_until_it_acts_and_freezes_with_its_salt_only", async () => {
    const commitment = guardianCommitment(accounts.tip, guardian.address, salt);
    const setGuardian = changePayload.setGuardian(commitment);
    const scheduled = await schedule(owners.tip, apps.tip, accounts.tip, setGuardian);
    await sleepUntil(scheduled.eta);
    await apply(accounts.tip, scheduled.changeId, setGuardian);
    expect((await protections(accounts.tip))[2]).toBe(commitment);
    // Neither the schedule transaction nor storage carries the guardian's address, and the same
    // guardian gives another account an unrelated commitment.
    const tx = await publicClient.getTransaction({ hash: scheduled.hash });
    expect(tx.input.toLowerCase().includes(guardian.address.slice(2).toLowerCase())).toBe(false);
    expect(guardianCommitment(accounts.vault, guardian.address, salt)).not.toBe(commitment);

    const freeze = (from: typeof guardian | typeof devAccount, withSalt: Hex) =>
      publicClient.simulateContract({ address: accounts.tip, abi: veraKeyAccountAbi, functionName: "guardianFreeze", args: [withSalt], account: from });
    expect(await revertName(freeze(guardian, keccak256(toHex("wrong salt"))))).toBe("NotGuardian");
    expect(await revertName(freeze(devAccount, salt))).toBe("NotGuardian");
    const { request } = await freeze(guardian, salt);
    await publicClient.waitForTransactionReceipt({ hash: await walletFor(guardian).writeContract(request) });
    expect((await protections(accounts.tip))[1]).toBe(true);
    const dl = deadline();
    const auth = await payArgs(owners.tip, apps.tip, accounts.tip, stranger, USDG(1), { deadline: dl });
    expect(await revertName(publicClient.simulateContract(payCall(accounts.tip, owners.tip, stranger, USDG(1), auth, dl)))).toBe("AccountFrozen");
  });
});
