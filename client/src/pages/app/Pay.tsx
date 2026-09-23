import type { ProofState } from "@verakey/sdk/client";
import { ScanFace, Store } from "lucide-react";
import { useMemo, useState } from "react";
import { isAddress, type Address } from "viem";
import { useSearch } from "wouter";
import { DEMO_APPS, appByKey } from "@/lib/apps";
import { formatUsdg, parseUsdg, shortHex } from "@/lib/format";
import { activity } from "@/lib/history";
import { useVeraKey } from "@/state/VeraKeyProvider";
import { Kicker, ProofReceipt, ProofTimeline, RejectionNote, type ReceiptData } from "./components";

const PROOF_BYTES = 9152;

export function Pay() {
  const { client, config, accounts, refreshAccounts } = useVeraKey();
  const search = useSearch();
  const [appKey, setAppKey] = useState(() => appByKey(new URLSearchParams(search).get("from") ?? undefined).key);
  const app = appByKey(appKey);
  const account = accounts[app.key];
  const merchant = config?.relayer.address as Address | undefined;
  const [recipient, setRecipient] = useState<string>("");
  const [amount, setAmount] = useState("2");
  const [state, setState] = useState<ProofState>({ status: "idle" });
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const to = (recipient || merchant || "") as Address;
  const units = parseUsdg(amount);
  const fee = config ? BigInt(config.relayer.fee) : 0n;
  const busy = ["authenticating", "proving", "relaying", "confirming"].includes(state.status);
  const remainingToday = account && account.deployed ? account.dailyCap - account.spentToday : null;
  const perTxCap = account?.deployed ? account.perTxCap : config ? BigInt(config.policy.perTxCap) : 0n;

  const problem = useMemo(() => {
    if (!isAddress(to)) return "Enter a valid recipient address.";
    if (units === null || units === 0n) return "Enter an amount.";
    if (!account) return "Loading this account's balance…";
    // Above the cap the contract refuses before it looks at the balance, which is the point of the
    // "try over the cap" demo; within the cap, an unaffordable payment is blocked here.
    if (account && units + fee > account.balance && units + fee <= perTxCap) return "Not enough USDG in this account (amount + relayer fee).";
    return null;
  }, [to, units, fee, account, perTxCap]);
  const overCap = units !== null && units + fee > perTxCap;

  const submit = async () => {
    if (!client || !config || units === null || problem) return;
    setReceipt(null);
    try {
      let verified: Extract<ProofState, { status: "verified" }> | null = null;
      const tx = await client.pay(app.appId, to, units, next => {
        setState(next);
        if (next.status === "verified") verified = next;
      });
      const final = verified as Extract<ProofState, { status: "verified" }> | null;
      if (!final) return;
      const data: ReceiptData = {
        title: `Paid ${formatUsdg(units)} USDG`,
        hash: tx.transactionHash,
        gasUsed: tx.gasUsed,
        provingMs: final.provingMs,
        publicKeyOccurrences: final.publicKeyOccurrences,
        proofBytes: PROOF_BYTES,
        rows: [
          ["From", <code key="f">{app.name} · {shortHex(account?.address ?? "")}</code>],
          ["To", <code key="t">{shortHex(to)}{to === merchant ? " · demo merchant" : ""}</code>],
          ["Relayer fee", <code key="fee">{formatUsdg(fee, 2)} USDG, signed into the approval</code>],
        ],
      };
      setReceipt(data);
      activity.add({
        hash: tx.transactionHash, appKey: app.key, kind: "pay", label: `${formatUsdg(units)} USDG from ${app.name}`,
        gasUsed: tx.gasUsed.toString(), provingMs: final.provingMs, publicKeyOccurrences: final.publicKeyOccurrences, at: Date.now(),
      });
      refreshAccounts();
    } catch {
      // The timeline shows the rejection.
    }
  };

  return (
    <div className="vk-grid-2">
      <section className="vk-stack">
        <div>
          <Kicker>Pay with a passkey</Kicker>
          <h1 className="vk-title">Face ID in.<br /><em>A proof out.</em></h1>
        </div>
        <div className={`vk-panel vk-tone-${app.tone}`}>
          <div className="vk-panel-head"><span>Payment intent</span><span>USDG · {config?.chainName}</span></div>
          <div className="vk-panel-body vk-form">
            <div className="vk-field">
              <span>From account</span>
              <div className="vk-seg" role="radiogroup">
                {DEMO_APPS.map(a => (
                  <button key={a.key} role="radio" aria-checked={a.key === app.key} className={a.key === app.key ? "is-active" : ""} onClick={() => setAppKey(a.key)} disabled={busy}>
                    {a.name} · {accounts[a.key] ? formatUsdg(accounts[a.key]!.balance) : "…"}
                  </button>
                ))}
              </div>
            </div>
            <label className="vk-field">
              <span>Recipient</span>
              <input className="vk-input is-mono" placeholder={merchant ? `${merchant} (demo merchant)` : "0x…"} value={recipient} onChange={e => setRecipient(e.target.value.trim())} disabled={busy} spellCheck={false} />
            </label>
            {!recipient && merchant && (
              <div className="vk-note" style={{ padding: "9px 12px" }}>
                <Store size={14} /> Paying the demo merchant: USDG goes back to the faucet treasury for the next visitor.
              </div>
            )}
            <label className="vk-field">
              <span>Amount (USDG)</span>
              <input className="vk-input is-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy} />
            </label>
            <div className="vk-quote">
              <div><span>Relayer fee (paid in USDG, no ETH needed)</span><span className="vk-mono">{formatUsdg(fee, 2)}</span></div>
              <div><span>Per-payment cap</span><span className="vk-mono">{formatUsdg(perTxCap)}</span></div>
              <div><span>Left today</span><span className="vk-mono">{remainingToday !== null ? formatUsdg(remainingToday) : "—"}</span></div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="vk-btn vk-btn-primary vk-btn-lg" style={{ flex: 1 }} disabled={busy || !!problem} onClick={submit}>
                {busy ? <span className="vk-spinner" /> : <ScanFace size={17} />} Approve with passkey
              </button>
              <button className="vk-btn vk-btn-ghost vk-btn-lg" disabled={busy} onClick={() => setAmount(formatUsdg(perTxCap + 1_000_000n).replace(/,/g, ""))} title="Shows that a valid proof is still bound by policy">
                Try over the cap
              </button>
            </div>
            {problem && state.status === "idle" && <p style={{ margin: 0, color: "var(--vk-faint)", fontSize: 12 }}>{problem}</p>}
            {!problem && overCap && state.status === "idle" && (
              <div className="vk-note is-policy">Above the per-payment cap. Your passkey can still approve it, but the account will refuse: authentication is not authorization.</div>
            )}
          </div>
        </div>
      </section>

      <section className="vk-stack" style={{ position: "sticky", top: 98 }}>
        <div className="vk-panel">
          <div className="vk-panel-head"><span>Authorization</span><span>{state.status === "idle" ? "ready" : state.status}</span></div>
          <div className="vk-panel-body">
            <ProofTimeline state={state} />
            {state.status === "rejected" && <div style={{ marginTop: 14 }}><RejectionNote state={state} /></div>}
          </div>
        </div>
        {receipt && config && <ProofReceipt receipt={receipt} config={config} />}
      </section>
    </div>
  );
}
