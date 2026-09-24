import type { NetworkConfig } from "@shared/api";
import type { ProofState } from "@verakey/sdk/client";
import { AlertTriangle, Check, Cpu, Fingerprint, Link2, Radio, ShieldX } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { explorerTx } from "@/lib/config";
import { formatGas, shortHex } from "@/lib/format";

export function Kicker({ children }: { children: ReactNode }) {
  return <div className="vk-kicker">{children}</div>;
}

/** Re-renders every `intervalMs` while `active`; returns the current time in ms. */
export function useNow(active = true, intervalMs = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

type StepKey = "authenticating" | "proving" | "relaying" | "confirming";
const ORDER: StepKey[] = ["authenticating", "proving", "relaying", "confirming"];

function stepIndex(state: ProofState): number {
  switch (state.status) {
    case "authenticating": return 0;
    case "proving": return 1;
    case "relaying": return 2;
    case "confirming": return 3;
    case "verified": return 4;
    default: return -1;
  }
}

const REJECTION_STEP: Record<string, StepKey> = {
  funds: "authenticating",
  authentication: "authenticating",
  device: "authenticating",
  proof: "proving",
  policy: "relaying",
  relay: "relaying",
};

/** The authorization pipeline, step by step: passkey, proof, relay, chain. */
/** `offChain`: a proof made to hand to someone (a disclosure, or a sign-in for a site), so there is no relay or transaction. */
export function ProofTimeline({ state, lastProvingMs, offChain }: { state: ProofState; lastProvingMs?: number; offChain?: "disclosure" | "sign-in" }) {
  const failedAt = state.status === "rejected" ? ORDER.indexOf(REJECTION_STEP[state.stage]) : -1;
  // A rejection at step k means every earlier step succeeded (e.g. a valid proof blocked by policy).
  const current = state.status === "rejected" ? failedAt : stepIndex(state);
  const now = useNow(state.status === "proving");
  // Remember the proving time across a policy rejection: the proof itself succeeded.
  const lastProving = useRef<number | undefined>(undefined);
  if (state.status === "authenticating") lastProving.current = undefined;
  if ("provingMs" in state) lastProving.current = state.provingMs;
  const provingMs =
    state.status === "proving" ? now - state.startedAt
      : "provingMs" in state ? state.provingMs
        : state.status === "rejected" ? lastProving.current
          : lastProvingMs;

  const steps: { key: StepKey; icon: ReactNode; title: string; detail: string; meta?: string }[] = [
    { key: "authenticating", icon: <Fingerprint size={15} />, title: "Passkey", detail: "Face ID, Touch ID or PIN signs this exact action on your device." },
    {
      key: "proving", icon: <Cpu size={15} />, title: "Zero-knowledge proof",
      detail: "Your public key, signature and PRF secret stay in this browser. Only the proof leaves.",
      meta: provingMs !== undefined ? `${(provingMs / 1000).toFixed(1)}s` : undefined,
    },
    { key: "relaying", icon: <Radio size={15} />, title: "Gasless relay", detail: "The relayer simulates the call, then submits it. It never sees your key." },
    {
      key: "confirming", icon: <Link2 size={15} />, title: "Arbitrum",
      detail: "The Stylus account verifies the proof, applies your policy and moves USDG.",
      meta: state.status === "verified" ? `block ${state.receipt.blockNumber}` : undefined,
    },
  ];

  const shown =
    offChain === "disclosure"
      ? [
          { ...steps[0], detail: "Face ID, Touch ID or PIN approves this exact disclosure statement." },
          { ...steps[1], detail: "Proves one passkey owns both accounts. The key, signature and PRF secret stay here." },
        ]
      : offChain === "sign-in"
        ? [
            { ...steps[0], detail: "Face ID, Touch ID or PIN approves this sign-in, for this site only." },
            { ...steps[1], detail: "Proves your passkey approved it. The key, signature and PRF secret stay here." },
          ]
        : steps;
  return (
    <div className="vk-timeline" aria-live="polite">
      {shown.map((step, i) => {
        const failed = failedAt === i;
        const done = current > i || (state.status === "verified" && i <= 3);
        const active = current === i && !done;
        const cls = failed ? "is-failed" : done ? "is-done" : active ? "is-active" : "";
        return (
          <div key={step.key} className={`vk-step ${cls}`}>
            <span className="vk-step-icon">{failed ? <ShieldX size={15} /> : done ? <Check size={15} /> : step.icon}</span>
            <span>
              <b>{step.title}</b>
              <small>{step.detail}</small>
            </span>
            <span className="vk-step-meta">{step.meta ?? (active ? <span className="vk-spinner" /> : "")}</span>
          </div>
        );
      })}
    </div>
  );
}

const POLICY_COPY: Record<string, string> = {
  PerTxCapExceeded: "Your proof is valid, but this amount is above the account's per-payment cap.",
  DailyCapExceeded: "Your proof is valid, but this payment would go over today's spending cap.",
  RecipientNotAllowed: "Your proof is valid, but this recipient is not on the account's allowlist.",
  InvalidRecipient: "That recipient address cannot receive payments from this account.",
  NotOwner: "This passkey is not an owner of this account.",
  ChangeNotReady: "The timelock has not passed yet.",
  UnknownChange: "That change is no longer pending.",
  LastOwner: "An account must keep at least one owner passkey.",
  TokenTransferFailed: "Your proof is valid, but this account holds less USDG than the amount plus the relayer fee. Get demo USDG on the Accounts page.",
  NewPayeeCapExceeded: "Your proof is valid, but this is the first payment to this address and it is above the new-recipient cap. Pay a smaller amount first, or allowlist the recipient on the Policy page.",
  AccountFrozen: "Your proof is valid, but this account is frozen. Unfreeze it on the Policy page (timelocked).",
  NotRestrictive: "That change would loosen the account, so it has to be scheduled with the timelock.",
  FeeTooHigh: "The relayer fee is above this account's fee limit, so the account would refuse it.",
  PaymentSheetRequired: "This account only pays through the browser's payment sheet (Chrome on macOS, Windows or Android, with this passkey enrolled for it). Stopping the requirement is a timelocked change on the Policy page.",
  TooManyPendingChanges: "Eight changes are already waiting. Apply or cancel some on the Policy page first; freezing cancels them all.",
  CannotVetoGuardianChange: "A guardian cannot cancel a change to the guardian itself.",
};

/** The refusals whose advice names an app page, worded for the account a site keeps: players act in the popup. */
const SITE_COPY: Record<string, string> = {
  TokenTransferFailed: "Your proof is valid, but this account holds less USDG than the amount plus the relayer fee. Top it up, then try again.",
  NewPayeeCapExceeded: "Your proof is valid, but this is the account's first payment to this recipient and it is above the new-recipient cap. The site can ask for a smaller amount first.",
  AccountFrozen: "Your proof is valid, but this account is frozen.",
  PaymentSheetRequired: "This account only pays through the browser's payment sheet.",
  TooManyPendingChanges: "Eight changes are already waiting on this account.",
};

const HEADLINE: Record<string, string> = {
  funds: "Not enough USDG.",
  policy: "Authenticated, not authorized.",
  device: "This device can't be used.",
};

/** `site`: the account a site keeps for the player, shown in the Sign in with VeraKey popup. */
export function RejectionNote({ state, site = false, testId }: { state: Extract<ProofState, { status: "rejected" }>; site?: boolean; testId?: string }) {
  // A valid proof whose payment or fee the account cannot cover.
  const unfunded = state.revert === "TokenTransferFailed";
  const soft = unfunded || state.stage === "policy" || state.stage === "funds";
  const message = (state.revert && ((site && SITE_COPY[state.revert]) || POLICY_COPY[state.revert])) ?? state.message;
  return (
    <div className={`vk-note ${soft ? "is-policy" : "is-error"}`} role="alert" data-testid={testId}>
      <AlertTriangle size={15} />
      <span>
        <b>{unfunded ? "Authenticated, not funded." : (HEADLINE[state.stage] ?? "Not completed.")}</b>{" "}
        {message}
        {state.stage === "funds" && (site ? " Top up the account, then try again." : " Get demo USDG on the Accounts page.")}
        {state.revert && <span className="vk-mono"> ({state.revert})</span>}
      </span>
    </div>
  );
}

export interface ReceiptData {
  title: string;
  hash: `0x${string}`;
  gasUsed: bigint;
  provingMs: number;
  publicKeyOccurrences: number;
  proofBytes: number;
  rows: [string, ReactNode][];
}

/** The artifact a user keeps: what happened, and proof that their key never reached the chain. */
export function ProofReceipt({ receipt, config }: { receipt: ReceiptData; config: Pick<NetworkConfig, "explorerUrl"> }) {
  const link = explorerTx(config, receipt.hash);
  return (
    <div className="vk-receipt">
      <div className="vk-stamp">ZK<br />VERIFIED</div>
      <div style={{ fontSize: 9, letterSpacing: "0.16em", color: "#4d6a5b" }}>VERAKEY RECEIPT</div>
      <div style={{ margin: "6px 0 14px", fontSize: 22, fontWeight: 600, letterSpacing: "-0.05em" }}>{receipt.title}</div>
      {receipt.rows.map(([label, value]) => (
        <div className="vk-receipt-row" key={label}>
          <span>{label}</span>
          <span>{value}</span>
        </div>
      ))}
      <div className="vk-receipt-row">
        <span>Transaction</span>
        {link ? <a href={link} target="_blank" rel="noreferrer">{shortHex(receipt.hash, 10, 8)} ↗</a> : <code>{shortHex(receipt.hash, 10, 8)}</code>}
      </div>
      <div className="vk-receipt-row"><span>Proof</span><code>UltraHonk · {receipt.proofBytes.toLocaleString("en-US")} bytes · {(receipt.provingMs / 1000).toFixed(1)}s in-browser</code></div>
      <div className="vk-receipt-row"><span>Gas used</span><code>{formatGas(receipt.gasUsed)}</code></div>
      <div className="vk-receipt-zero">
        <strong>{receipt.publicKeyOccurrences}</strong>
        <p>
          times your passkey's public key appears in this transaction's calldata. The chain received a
          proof, a per-app nullifier and the browser's clientDataJSON. Nothing else.
        </p>
      </div>
    </div>
  );
}
