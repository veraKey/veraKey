// The Pay screen as views that only take props. Pay.tsx passes the live payment and the landing-page
// hero passes a scripted one, so the hero always shows exactly what the app shows. Wide screens get
// the authorization timeline and the receipt; the phone layout runs the same payment full-screen.
import type { NetworkConfig } from "@shared/api";
import type { ProofState } from "@verakey/sdk/client";
import { ArrowUpRight, Check, LockKeyhole, ScanFace, Store } from "lucide-react";
import { useState } from "react";
import { explorerTx } from "@/lib/config";
import { formatUsdg, parseUsdg, shortHex } from "@/lib/format";
import { Kicker, ProofReceipt, ProofTimeline, RejectionNote, useNow, type ReceiptData } from "./components";

export const PROOF_BYTES = 9152;
/** Typical in-browser proving time (Chrome, 8 threads). It paces the phone layout's progress ring. */
const PROVING_ESTIMATE_MS = 2300;

export interface PayViewProps {
  accountName: string;
  tone: string;
  /** USDG base units; null while the account is loading. */
  balance: bigint | null;
  /** The relayer's address: paid when no recipient is entered. */
  merchant: string | null;
  recipient: string;
  amount: string;
  fee: bigint;
  perTxCap: bigint;
  remainingToday: bigint | null;
  chainName: string;
  state: ProofState;
  receipt: ReceiptData | null;
  explorer: Pick<NetworkConfig, "explorerUrl">;
  /** Why the payment cannot be submitted yet, if it cannot. */
  problem: string | null;
  overCap: boolean;
  onRecipient?: (value: string) => void;
  onAmount?: (value: string) => void;
  onSubmit?: () => void;
  onTryOverCap?: () => void;
  /** Phone layout: closes the paid screen. */
  onDone?: () => void;
}

type BusyStatus = "authenticating" | "proving" | "relaying" | "confirming";
const isBusy = (state: ProofState): state is Extract<ProofState, { status: BusyStatus }> =>
  state.status === "authenticating" || state.status === "proving" || state.status === "relaying" || state.status === "confirming";
const balanceText = (balance: bigint | null) => (balance === null ? "loading…" : `${formatUsdg(balance)} USDG`);

function SubmitHints({ problem, overCap, state }: Pick<PayViewProps, "problem" | "overCap" | "state">) {
  if (state.status !== "idle") return null;
  if (problem) return <p className="vk-hint">{problem}</p>;
  if (overCap) {
    return (
      <div className="vk-note is-policy">
        Above the per-payment cap. Your passkey can still approve it, but the account will refuse: authentication is not authorization.
      </div>
    );
  }
  return null;
}

/** Wide screens: the payment form beside the authorization timeline and the receipt. */
export function PayDesktop(props: PayViewProps) {
  const { state } = props;
  const busy = isBusy(state);
  return (
    <div className="vk-grid-2">
      <section className="vk-stack">
        <div>
          <Kicker>Pay with a passkey</Kicker>
          <h1 className="vk-title">Face ID in.<br /><em>A proof out.</em></h1>
        </div>
        <div className={`vk-panel vk-tone-${props.tone}`}>
          <div className="vk-panel-head"><span>Payment intent</span><span>USDG · {props.chainName}</span></div>
          <div className="vk-panel-body vk-form">
            <div className="vk-field">
              <span>From account</span>
              <div className="vk-input is-mono is-static">{props.accountName} · {balanceText(props.balance)}</div>
            </div>
            <label className="vk-field">
              <span>Recipient</span>
              <input
                className="vk-input is-mono"
                placeholder={props.merchant ? `${props.merchant} (demo merchant)` : "0x…"}
                value={props.recipient}
                onChange={e => props.onRecipient?.(e.target.value.trim())}
                readOnly={!props.onRecipient}
                disabled={busy}
                spellCheck={false}
              />
            </label>
            {!props.recipient && props.merchant && (
              <div className="vk-note" style={{ padding: "9px 12px" }}>
                <Store size={14} /> Paying the demo merchant: USDG goes back to the faucet treasury for the next visitor.
              </div>
            )}
            <label className="vk-field">
              <span>Amount (USDG)</span>
              <input
                className="vk-input is-amount"
                inputMode="decimal"
                value={props.amount}
                onChange={e => props.onAmount?.(e.target.value)}
                readOnly={!props.onAmount}
                disabled={busy}
              />
            </label>
            <div className="vk-quote">
              <div><span>Relayer fee (paid in USDG, no ETH needed)</span><span className="vk-mono">{formatUsdg(props.fee, 2)}</span></div>
              <div><span>Per-payment cap</span><span className="vk-mono">{formatUsdg(props.perTxCap)}</span></div>
              <div><span>Left today</span><span className="vk-mono">{props.remainingToday !== null ? formatUsdg(props.remainingToday) : "—"}</span></div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="vk-btn vk-btn-primary vk-btn-lg" style={{ flex: 1 }} disabled={busy || !!props.problem} onClick={props.onSubmit}>
                {busy ? <span className="vk-spinner" /> : <ScanFace size={17} />} Approve with passkey
              </button>
              <button className="vk-btn vk-btn-ghost vk-btn-lg" disabled={busy} onClick={props.onTryOverCap} title="Shows that a valid proof is still bound by policy">
                Try over the cap
              </button>
            </div>
            <SubmitHints problem={props.problem} overCap={props.overCap} state={state} />
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
        {props.receipt && <ProofReceipt receipt={props.receipt} config={props.explorer} />}
      </section>
    </div>
  );
}

/** Phone layout: one card and one button; the payment then takes over the screen until it is done. */
export function PayMobile(props: PayViewProps) {
  const { state } = props;
  const busy = isBusy(state);
  const [editingRecipient, setEditingRecipient] = useState(false);
  const to = props.recipient ? shortHex(props.recipient) : "Demo merchant";
  const units = parseUsdg(props.amount);

  return (
    <div className="vk-mpay">
      <div>
        <Kicker>Pay with a passkey</Kicker>
        <h1 className="vk-mpay-title">Face ID in.<br /><em>A proof out.</em></h1>
      </div>

      <div className={`vk-mpay-card vk-tone-${props.tone}`}>
        <div className="vk-mpay-card-head"><span>{props.accountName} account</span><b>{balanceText(props.balance)}</b></div>
        <label className="vk-mpay-amount">
          {/* The hidden copy of the value (::after) sizes the field to its text. */}
          <span className="vk-mpay-amount-field" data-value={props.amount || "0"}>
            <input
              inputMode="decimal"
              aria-label="Amount in USDG"
              size={1}
              value={props.amount}
              onChange={e => props.onAmount?.(e.target.value)}
              readOnly={!props.onAmount}
              disabled={busy}
            />
          </span>
          <span>USDG</span>
        </label>
        <div className="vk-quote">
          <div><span>To</span><span>{to}</span></div>
          <div><span>Relayer fee</span><span className="vk-mono">{formatUsdg(props.fee, 2)} USDG</span></div>
          <div><span>Network</span><span>{props.chainName}</span></div>
        </div>
      </div>

      <button className="vk-btn vk-btn-primary vk-btn-lg vk-mpay-cta" disabled={busy || !!props.problem} onClick={props.onSubmit}>
        {busy ? <span className="vk-spinner" /> : <ScanFace size={18} />} Approve with passkey
      </button>
      <div className="vk-mpay-links">
        <button className="vk-btn vk-btn-quiet" disabled={busy} onClick={() => setEditingRecipient(open => !open)}>Pay someone else</button>
        <button className="vk-btn vk-btn-quiet" disabled={busy} onClick={props.onTryOverCap}>Try over the cap</button>
      </div>
      {(editingRecipient || props.recipient) && (
        <input
          className="vk-input is-mono"
          aria-label="Recipient address"
          placeholder="0x…"
          value={props.recipient}
          onChange={e => props.onRecipient?.(e.target.value.trim())}
          readOnly={!props.onRecipient}
          disabled={busy}
          spellCheck={false}
        />
      )}
      <SubmitHints problem={props.problem} overCap={props.overCap} state={state} />
      {state.status === "rejected" && <RejectionNote state={state} />}

      <div className="vk-mpay-privacy">
        <div><span>Leaves this device</span><b>proof · nullifier · clientDataJSON</b></div>
        <div><span>Stays on it</span><b><LockKeyhole size={12} /> key · signature · PRF secret</b></div>
      </div>

      {busy && <ProofOverlay state={state} />}
      {state.status === "verified" && (
        <PaidScreen
          amount={units !== null ? formatUsdg(units) : props.amount}
          to={to}
          fee={props.fee}
          state={state}
          link={props.receipt ? explorerTx(props.explorer, props.receipt.hash) : null}
          onDone={props.onDone}
        />
      )}
    </div>
  );
}

const OVERLAY_COPY: Record<BusyStatus, [string, string]> = {
  authenticating: ["Approve with your passkey", "Face ID, Touch ID or PIN"],
  proving: ["Proving on this device", "UltraHonk · in the browser"],
  relaying: ["Sending the proof", "Gasless · fee paid in USDG"],
  confirming: ["Confirming on Arbitrum", "The Stylus account verifies it"],
};

function ProofOverlay({ state }: { state: Extract<ProofState, { status: BusyStatus }> }) {
  const now = useNow(state.status === "proving");
  const provingMs = state.status === "proving" ? now - state.startedAt : "provingMs" in state ? state.provingMs : 0;
  const progress = state.status === "authenticating" ? 0 : state.status === "proving" ? Math.min(provingMs / PROVING_ESTIMATE_MS, 0.96) : 1;
  const [title, detail] = OVERLAY_COPY[state.status];
  return (
    <div className="vk-mpay-overlay" role="status">
      <div className="vk-mpay-ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="vk-mpay-ring-track" cx="60" cy="60" r="52" />
          <circle className="vk-mpay-ring-fill" cx="60" cy="60" r="52" pathLength="100" style={{ strokeDashoffset: 100 - progress * 100 }} />
        </svg>
        {state.status === "authenticating" ? <ScanFace size={46} strokeWidth={1.4} /> : <strong>{(provingMs / 1000).toFixed(1)}<small>s</small></strong>}
      </div>
      <b className="vk-mpay-overlay-title">{title} {(state.status === "relaying" || state.status === "confirming") && <span className="vk-spinner" />}</b>
      <span className="vk-mpay-overlay-detail">{detail}</span>
      <ul className="vk-mpay-secrets">
        <li><LockKeyhole size={13} /> Public key</li>
        <li><LockKeyhole size={13} /> Signature</li>
        <li><LockKeyhole size={13} /> PRF secret</li>
      </ul>
      <span className="vk-mpay-overlay-detail">stay on this device</span>
    </div>
  );
}

function PaidScreen(props: {
  amount: string;
  to: string;
  fee: bigint;
  state: Extract<ProofState, { status: "verified" }>;
  link: string | null;
  onDone?: () => void;
}) {
  return (
    <div className="vk-mpay-overlay is-paid" role="status">
      <span className="vk-mpay-check"><Check size={46} strokeWidth={2.4} /></span>
      <b className="vk-mpay-overlay-title">Paid</b>
      <strong className="vk-mpay-paid-amount">{props.amount} USDG</strong>
      <span className="vk-mpay-overlay-detail">to {props.to}</span>
      <div className="vk-quote vk-mpay-paid-quote">
        <div><span>Proof on this device</span><span className="vk-mono">{(props.state.provingMs / 1000).toFixed(1)} s</span></div>
        <div><span>Relayer fee</span><span className="vk-mono">{formatUsdg(props.fee, 2)} USDG</span></div>
        <div><span>Public key on-chain</span><span className="vk-mono vk-mpay-zero">{props.state.publicKeyOccurrences}×</span></div>
      </div>
      <div className="vk-mpay-actions">
        {props.link && <a className="vk-btn vk-btn-ghost" href={props.link} target="_blank" rel="noreferrer">Arbiscan <ArrowUpRight size={14} /></a>}
        {props.onDone && <button className="vk-btn vk-btn-primary" onClick={props.onDone}>Done</button>}
      </div>
    </div>
  );
}
