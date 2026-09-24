// Regression tests for the internal audit of 2026-09-24 (Nemesis: Feynman and state-inconsistency passes),
// on the real contracts with real proofs. Each test reproduces a finding's attack and expects the fix.
//
//   pnpm --filter @verakey/sdk exec vitest run --config vitest.e2e.config.ts test/e2e/audit.e2e.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keccak256, parseEventLogs, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ActionKind,
  VeraKeyProver,
  ZERO_HASH,
  appIdFromName,
  changeDataHash,
  changePayload,
  computeNullifier,
  guardianCommitment,
  veraKeyAccountAbi,
  veraKeyFactoryAbi,
} from "../../src";
import {
  USDG,
  VirtualPasskey,
  authorize,
  deployment,
  devAccount,
  fieldHex,
  publicClient,
  revertName,
  waitForChainTime,
  walletFor,
  type Owner,
} from "./harness";

const { factory, usdg } = deployment.contracts;
const relayer = walletFor(devAccount);
const FEE = USDG(0.01);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 300);

type Change = { kind: number; payload: Hex };
interface Ctx {
  appId: bigint;
  owner: Owner;
  account: Address;
}

let prover: VeraKeyProver;
let passkey: VirtualPasskey;

const mintAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [] },
] as const;

async function newAccount(label: string, funds: bigint, owner?: VirtualPasskey): Promise<Ctx> {
  const key = owner ?? passkey;
  const appId = appIdFromName(`nemesis-${label}-${Date.now()}`);
  const nullifier = await computeNullifier(prover.barretenberg, key.publicKey, key.prfSecret, appId);
  const { request, result } = await publicClient.simulateContract({
    address: factory, abi: veraKeyFactoryAbi, functionName: "createAccount", args: [fieldHex(appId), fieldHex(nullifier)], account: devAccount,
  });
  await publicClient.waitForTransactionReceipt({ hash: await relayer.writeContract(request) });
  await publicClient.waitForTransactionReceipt({
    hash: await relayer.writeContract({ address: usdg, abi: mintAbi, functionName: "mint", args: [result, funds] }),
  });
  return { appId, owner: { passkey: key, nullifier }, account: result };
}

/** A signed, proven call to one of the account's proof-authorized functions, simulated as the relayer would. */
async function call(ctx: Ctx, fn: "pay" | "scheduleChange" | "restrict" | "cancelChange" | "cancelRecovery", opts: {
  change?: Change; to?: Address; amount?: bigint; changeId?: Hex; recoveryNullifier?: Hex; fee?: bigint;
}) {
  const fee = opts.fee ?? FEE;
  const dl = deadline();
  const kind = { pay: ActionKind.Pay, scheduleChange: ActionKind.ScheduleChange, restrict: ActionKind.Restrict, cancelChange: ActionKind.CancelChange, cancelRecovery: ActionKind.CancelRecovery }[fn];
  const dataHash = opts.change ? changeDataHash(opts.change.kind as never, opts.change.payload) : (opts.changeId ?? opts.recoveryNullifier ?? ZERO_HASH);
  const auth = await authorize(prover, ctx.owner, ctx.appId, ctx.account, {
    kind, target: opts.to ?? ZERO_ADDRESS, amount: opts.amount ?? 0n, dataHash, fee, deadline: dl,
  });
  const tail = [fee, dl, fieldHex(ctx.owner.nullifier), auth.clientDataJSON, auth.proof] as const;
  const args =
    fn === "pay" ? [opts.to!, opts.amount!, ...tail]
      : fn === "cancelChange" ? [opts.changeId!, ...tail]
        : fn === "cancelRecovery" ? [...tail]
          : [opts.change!.kind, opts.change!.payload, ...tail];
  return publicClient.simulateContract({ address: ctx.account, abi: veraKeyAccountAbi, functionName: fn, args, account: devAccount } as never);
}

async function send(simulation: Promise<{ request: unknown }>) {
  const { request } = await simulation;
  const receipt = await publicClient.waitForTransactionReceipt({ hash: await relayer.writeContract(request as never) });
  expect(receipt.status).toBe("success");
  return receipt;
}

async function schedule(ctx: Ctx, change: Change) {
  const receipt = await send(call(ctx, "scheduleChange", { change }));
  const [event] = parseEventLogs({ abi: veraKeyAccountAbi, eventName: "ChangeScheduled", logs: receipt.logs });
  return { changeId: event.args.changeId, eta: event.args.eta };
}

async function apply(ctx: Ctx, changeId: Hex, change: Change) {
  const { request } = await publicClient.simulateContract({
    address: ctx.account, abi: veraKeyAccountAbi, functionName: "applyChange", args: [changeId, change.kind, change.payload], account: devAccount,
  });
  return publicClient.waitForTransactionReceipt({ hash: await relayer.writeContract(request) });
}

const read = <T>(ctx: Ctx, functionName: string, args: readonly unknown[] = []) =>
  publicClient.readContract({ address: ctx.account, abi: veraKeyAccountAbi, functionName, args } as never) as Promise<T>;

beforeAll(async () => {
  prover = await VeraKeyProver.create({ threads: 8 });
  passkey = await VirtualPasskey.create();
}, 180_000);

afterAll(async () => {
  await prover?.destroy();
});

const changeDelay = BigInt(deployment.policy.changeDelay);
const recoveryDelay = BigInt(deployment.policy.recoveryDelay);

describe("NM-001: the caps never stop the owners from defending the account", () => {
  it("with the day's cap spent, the owner still vetoes a waiting change and freezes", async () => {
    const ctx = await newAccount("caps", USDG(50));
    const thief = privateKeyToAccount(generatePrivateKey()).address;
    const thiefKey = await VirtualPasskey.create();
    const thiefOwner = await computeNullifier(prover.barretenberg, thiefKey.publicKey, thiefKey.prfSecret, ctx.appId);

    // A thief holding the owner's passkey schedules a second owner it controls, then spends the day's cap.
    const addThief = changePayload.addOwner(fieldHex(thiefOwner));
    const pending = await schedule(ctx, addThief);
    await send(call(ctx, "restrict", { change: changePayload.setLimits(USDG(10), USDG(10)) }));
    await send(call(ctx, "pay", { to: thief, amount: USDG(4.99) }));
    await send(call(ctx, "pay", { to: thief, amount: USDG(4.97) }));
    const [, dailyCap, spent] = await read<readonly [bigint, bigint, bigint, bigint, boolean]>(ctx, "policy");
    expect(spent).toBe(dailyCap);

    // The veto and the emergency brake still go through the relayer, fee and all.
    await send(call(ctx, "cancelChange", { changeId: pending.changeId }));
    await send(call(ctx, "restrict", { change: changePayload.freeze() }));
    expect((await read<readonly [bigint, boolean, Hex, boolean]>(ctx, "protections"))[1]).toBe(true);
    // Their fees still count toward the day's spending.
    expect((await read<readonly [bigint, bigint, bigint, bigint, boolean]>(ctx, "policy"))[2]).toBe(dailyCap + 2n * FEE);
    await waitForChainTime(pending.eta);
    expect(await revertName(publicClient.simulateContract({
      address: ctx.account, abi: veraKeyAccountAbi, functionName: "applyChange", args: [pending.changeId, addThief.kind, addThief.payload], account: devAccount,
    }))).toBe("UnknownChange");
  });

  it("the per-payment cap can't drop below the largest fee, so management stays payable", async () => {
    const ctx = await newAccount("floor", USDG(10));
    const maxFee = BigInt(deployment.policy.maxFee!);
    expect(await revertName(call(ctx, "restrict", { change: changePayload.setLimits(maxFee - 1n, maxFee - 1n) }))).toBe("InvalidChange");
    expect(await revertName(call(ctx, "scheduleChange", { change: changePayload.setLimits(maxFee - 1n, USDG(25)) }))).toBe("InvalidChange");
    // At the floor, the owner still schedules a raise and freezes.
    await send(call(ctx, "restrict", { change: changePayload.setLimits(maxFee, maxFee) }));
    await send(call(ctx, "scheduleChange", { change: changePayload.setLimits(USDG(10), USDG(25)) }));
    await send(call(ctx, "restrict", { change: changePayload.freeze() }));
  });

  it("a daily cap lowered below today's spending doesn't block the owner's freeze", async () => {
    const ctx = await newAccount("below", USDG(20));
    const shop = privateKeyToAccount(generatePrivateKey()).address;
    await send(call(ctx, "pay", { to: shop, amount: USDG(4.99) }));
    await send(call(ctx, "restrict", { change: changePayload.setLimits(USDG(1), USDG(1)) }));
    await send(call(ctx, "restrict", { change: changePayload.freeze() }));
    expect((await read<readonly [bigint, boolean, Hex, boolean]>(ctx, "protections"))[1]).toBe(true);
  });
});

describe("NM-002: a recovery belongs to the guardian that started it", () => {
  it("removing the guardian cancels the recovery it started just before", async () => {
    const ctx = await newAccount("guardian", USDG(10));
    const rescueKey = await VirtualPasskey.create();
    const rescue = await computeNullifier(prover.barretenberg, rescueKey.publicKey, rescueKey.prfSecret, ctx.appId);
    const guardian = privateKeyToAccount(generatePrivateKey());
    await publicClient.waitForTransactionReceipt({ hash: await relayer.sendTransaction({ to: guardian.address, value: 10n ** 16n }) });
    const salt = keccak256(toHex("audit guardian salt"));

    const setGuardian = changePayload.setGuardian(guardianCommitment(ctx.account, guardian.address, salt));
    const set = await schedule(ctx, setGuardian);
    await waitForChainTime(set.eta);
    await apply(ctx, set.changeId, setGuardian);

    const remove = changePayload.setGuardian(ZERO_HASH);
    const removal = await schedule(ctx, remove);
    // Just before the removal lands, the guardian starts a recovery to a passkey it controls.
    await waitForChainTime(removal.eta - recoveryDelay + 1n);
    const { request: initiate } = await publicClient.simulateContract({
      address: ctx.account, abi: veraKeyAccountAbi, functionName: "initiateRecovery", args: [fieldHex(rescue), salt], account: guardian,
    });
    await publicClient.waitForTransactionReceipt({ hash: await walletFor(guardian).writeContract(initiate) });

    await waitForChainTime(removal.eta);
    const applied = await apply(ctx, removal.changeId, remove);
    expect(parseEventLogs({ abi: veraKeyAccountAbi, eventName: "RecoveryCancelled", logs: applied.logs })).toHaveLength(1);
    expect((await read<readonly [Hex, bigint]>(ctx, "recovery"))[1]).toBe(0n);
    expect(await revertName(publicClient.simulateContract({
      address: ctx.account, abi: veraKeyAccountAbi, functionName: "executeRecovery", account: devAccount,
    }))).toBe("NoRecovery");
    expect(await read<boolean>(ctx, "isOwner", [fieldHex(ctx.owner.nullifier)])).toBe(true);
  });
});

describe("NM-003, NM-004, NM-005: what the timelock accepts", () => {
  it("every change to the guardian, even the first, waits the change delay plus the recovery delay", async () => {
    const ctx = await newAccount("first-guardian", USDG(5));
    const receipt = await send(call(ctx, "scheduleChange", { change: changePayload.setGuardian(keccak256(toHex("any commitment"))) }));
    const [event] = parseEventLogs({ abi: veraKeyAccountAbi, eventName: "ChangeScheduled", logs: receipt.logs });
    const { timestamp } = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    expect(event.args.eta - timestamp).toBe(changeDelay + recoveryDelay);
  });

  it("a freeze can't go through the timelock: it is always instant", async () => {
    const ctx = await newAccount("scheduled-freeze", USDG(5));
    expect(await revertName(call(ctx, "scheduleChange", { change: changePayload.freeze() }))).toBe("InvalidChange");
  });

  it("owner changes that could never apply are refused when they are scheduled", async () => {
    const ctx = await newAccount("owners", USDG(5));
    const strangerKey = await VirtualPasskey.create();
    const stranger = await computeNullifier(prover.barretenberg, strangerKey.publicKey, strangerKey.prfSecret, ctx.appId);
    expect(await revertName(call(ctx, "scheduleChange", { change: changePayload.addOwner(fieldHex(ctx.owner.nullifier)) }))).toBe("AlreadyOwner");
    expect(await revertName(call(ctx, "scheduleChange", { change: changePayload.removeOwner(fieldHex(stranger)) }))).toBe("NotOwner");
    expect(await revertName(call(ctx, "scheduleChange", { change: changePayload.removeOwner(fieldHex(ctx.owner.nullifier)) }))).toBe("LastOwner");
  });
});
