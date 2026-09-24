import { Check, KeyRound, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { veraKeyAccountAbi } from "@verakey/sdk/abi";
import { VeraKeyError, type ProofState, type RejectionStage } from "@verakey/sdk/client";
import type { ConnectErrorCode } from "@verakey/sdk/connect";
import { accountAddressOf, appIdFromOrigin, type PaymentResult } from "@verakey/sdk/signin";
import { BrandMark } from "@/components/BrandMark";
import { formatUsdg, shortHex } from "@/lib/format";
import { createClient, proverThreads, useVeraKey } from "@/state/VeraKeyProvider";
import { ProofTimeline, RejectionNote } from "../app/components";
import { ReceivePanel } from "../app/ReceivePanel";
import { useConnectRequest } from "./useConnectRequest";

const CODE: Record<RejectionStage, ConnectErrorCode> = {
  authentication: "cancelled", funds: "funds", policy: "policy", device: "device", proof: "proof", relay: "relay",
};

/** "Sign in with VeraKey": the popup a site opens to sign a player in, or to take a payment. */
export default function ConnectPage() {
  const connection = useConnectRequest();
  const { config } = useVeraKey();
  // No app ids: recovering a passkey's public key on a new device never looks accounts up on-chain.
  const client = useMemo(() => (config ? createClient(config, []) : null), [config]);
  const [busy, setBusy] = useState(false);
  const [playerId, setPlayerId] = useState<bigint | null>(null);
  // The account's balance, and whether the new-recipient cap still limits a payment to this recipient.
  const [holding, setHolding] = useState<{ balance: bigint; cap: bigint; knownRecipient: boolean } | null>(null);
  const [state, setState] = useState<ProofState>({ status: "idle" });
  const [finished, setFinished] = useState<null | "done" | "failed">(null);

  useEffect(() => {
    if (!client) return;
    const root = document.documentElement;
    root.dataset.proverThreads = String(proverThreads());
    client.prover().then(() => void (root.dataset.prover = "ready"), () => void (root.dataset.prover = "error"));
  }, [client]);

  const request = connection.status === "request" ? connection : null;
  const appId = useMemo(() => (request ? appIdFromOrigin(request.origin) : null), [request?.origin]);
  const account: Address | null = useMemo(
    () => (config && appId !== null && playerId !== null
      ? accountAddressOf({ factory: config.contracts.factory, accountImplementation: config.contracts.accountImplementation, configHash: config.configHash }, appId, playerId)
      : null),
    [config, appId, playerId]
  );
  const fee = config ? BigInt(config.relayer.fee) : 0n;
  const payment = request?.request.method === "pay" ? request.request.params : null;
  const amount = payment ? BigInt(payment.amount) : 0n;

  const fail = (error: unknown) => {
    const failure = error instanceof VeraKeyError ? error : new VeraKeyError("relay", error instanceof Error ? error.message : String(error));
    request?.reply.error(CODE[failure.stage], failure.message, failure.revert);
    setState({ status: "rejected", stage: failure.stage, message: failure.message, revert: failure.revert });
    setFinished("failed");
  };

  const readHolding = async () => {
    if (!client || !config || appId === null || !payment) return;
    const current = await client.account(appId);
    // An account that does not exist yet gets the factory's cap, and has paid no one.
    const knownRecipient = current.deployed
      ? await client.publicClient.readContract({ address: current.address, abi: veraKeyAccountAbi, functionName: "isKnownRecipient", args: [payment.to] })
      : false;
    setHolding({ balance: current.balance, cap: current.deployed ? current.newPayeeCap : BigInt(config.policy.newPayeeCap), knownRecipient });
  };

  const unlock = async (create: boolean) => {
    if (!client || appId === null) return;
    setBusy(true);
    try {
      if (create) {
        const { session } = await client.register("VeraKey");
        if (!session) await client.unlock();
      } else {
        await client.unlock();
      }
      setPlayerId(await client.nullifier(appId));
      if (payment) await readHolding();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    if (!client || !request || request.request.method !== "signIn" || appId === null) return;
    setBusy(true);
    try {
      request.reply.result(await client.proveSignIn(appId, { nonce: request.request.params.nonce, origin: request.origin }, setState));
      setFinished("done");
      window.close();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!client || !request || !payment || appId === null || !account) return;
    setBusy(true);
    try {
      const receipt = await client.pay(appId, payment.to, amount, next => {
        setState(next);
        if (next.status === "confirming") request.reply.progress(next.hash);
      });
      const result: PaymentResult = { version: 1, hash: receipt.transactionHash, account, to: payment.to, amount: amount.toString(), fee: fee.toString() };
      request.reply.result(result);
      setFinished("done");
      window.close();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const topUp = async () => {
    if (!client || appId === null || !account) return;
    setBusy(true);
    try {
      await client.ensureAccount(appId);
      await client.requestDemoFunds(account);
      await readHolding();
    } catch (error) {
      setState({ status: "rejected", stage: "funds", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    request?.reply.error("cancelled", "The player cancelled.");
    setFinished("failed");
    window.close();
  };

  const hasPasskey = (client?.store.list().length ?? 0) > 0;
  const player = playerId !== null ? `0x${playerId.toString(16).padStart(64, "0")}` : null;

  return (
    <div className="vk-app vk-connect">
      <header className="vk-connect-head"><BrandMark /><b>VeraKey</b></header>
      {connection.status === "no-opener" && <p className="vk-lede">Open this window from a site's Sign in with VeraKey button.</p>}
      {connection.status === "waiting" && <p className="vk-lede"><span className="vk-spinner" /> Waiting for the site…</p>}
      {connection.status === "rejected" && <div className="vk-note is-error" role="alert">{connection.message}</div>}
      {request && (
        <>
          <p className="vk-connect-requester">Requested by <b data-requester>{request.origin}</b></p>

          {player === null && finished === null && (
            <div className="vk-connect-actions">
              <p>
                {payment
                  ? `Pay ${formatUsdg(amount)} USDG with your VeraKey passkey.`
                  : "Sign in with your VeraKey passkey. This site gets a player ID that only it knows."}
              </p>
              {hasPasskey ? (
                <>
                  <button className="vk-btn vk-btn-primary" disabled={busy || !client} onClick={() => unlock(false)}><KeyRound size={15} /> Unlock with passkey</button>
                  <button className="vk-btn vk-btn-ghost" disabled={busy || !client} onClick={() => unlock(true)}>Create a VeraKey passkey</button>
                </>
              ) : (
                <>
                  <button className="vk-btn vk-btn-primary" disabled={busy || !client} onClick={() => unlock(true)}><KeyRound size={15} /> Create a VeraKey passkey</button>
                  <button className="vk-btn vk-btn-ghost" disabled={busy || !client} onClick={() => unlock(false)}>I already have a VeraKey passkey</button>
                </>
              )}
            </div>
          )}

          {player !== null && finished === null && !payment && (
            <div className="vk-connect-actions">
              <div className="vk-facts">
                <div className="vk-fact"><span>Player ID for this site</span><code>{shortHex(player, 10, 6)}</code></div>
                <div className="vk-fact"><span>Account</span><code>{account ? shortHex(account) : "…"}</code></div>
              </div>
              <p>This site learns only this player ID. It never sees your passkey or your accounts anywhere else.</p>
              <button className="vk-btn vk-btn-primary" disabled={busy} onClick={signIn}>
                <ShieldCheck size={15} /> Sign in to {new URL(request.origin).host}
              </button>
            </div>
          )}

          {player !== null && finished === null && payment && (
            <div className="vk-connect-actions">
              <div className="vk-facts">
                <div className="vk-fact"><span>Pay</span><code>{payment.to}</code></div>
                <div className="vk-fact"><span>Amount</span><code>{formatUsdg(amount)} USDG + {formatUsdg(fee)} fee</code></div>
                <div className="vk-fact"><span>Balance</span><code>{holding ? `${formatUsdg(holding.balance)} USDG` : "…"}</code></div>
              </div>
              {holding && !holding.knownRecipient && amount > holding.cap && (
                <div className="vk-note" role="note">
                  This account's first payment to a new recipient is capped at {formatUsdg(holding.cap)} USDG, so this payment will be refused.
                </div>
              )}
              {holding && holding.balance < amount + fee ? (
                <>
                  <p><b>Top up</b> first: VeraKey pays only from the account it keeps for this site.</p>
                  {account && <ReceivePanel account={account} />}
                  <button className="vk-btn vk-btn-ghost" disabled={busy} onClick={topUp}>Get demo USDG</button>
                  <button className="vk-btn vk-btn-quiet" disabled={busy} onClick={readHolding}>Check the balance again</button>
                </>
              ) : (
                <button className="vk-btn vk-btn-primary" disabled={busy || !holding} onClick={pay}>Pay {formatUsdg(amount)} USDG</button>
              )}
            </div>
          )}

          {state.status !== "idle" && state.status !== "rejected" && <ProofTimeline state={state} offChain={!payment} />}
          {state.status === "rejected" && <RejectionNote site state={state} />}
          {finished === "done" && <p className="vk-lede"><Check size={15} /> Done. You can close this window.</p>}
          {finished === null && <button className="vk-btn vk-btn-quiet" onClick={cancel}><X size={14} /> Cancel</button>}
          {finished === "failed" && <button className="vk-btn vk-btn-ghost" onClick={() => window.close()}>Close</button>}
        </>
      )}
    </div>
  );
}
