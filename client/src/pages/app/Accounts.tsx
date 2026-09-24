import type { AccountState } from "@verakey/sdk/client";
import { ArrowDownLeft, ArrowUpRight, Coins, Copy, Link2, RefreshCw, Rocket, X } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Address } from "viem";
import { Link } from "wouter";
import { DEMO_APPS, SECOND_APP, type DemoApp } from "@/lib/apps";
import { explorerAddress, explorerTx } from "@/lib/config";
import { formatUsdg, shortHex } from "@/lib/format";
import { activity } from "@/lib/history";
import { useVeraKey } from "@/state/VeraKeyProvider";
import { Kicker } from "./components";

/** EIP-681 request for USDG to `account`; wallets that scan it prefill a token transfer. */
function usdgRequest(usdg: string, chainId: number, account: string) {
  return `ethereum:${usdg}@${chainId}/transfer?address=${account}`;
}

/** Where to send USDG so it lands in this app's account without linking it to your other accounts. */
function ReceivePanel({ account, onClose }: { account: Address; onClose: () => void }) {
  const { config } = useVeraKey();
  const [svg, setSvg] = useState("");
  const uri = config ? usdgRequest(config.contracts.usdg, config.chainId, account) : "";
  useEffect(() => {
    if (uri) QRCode.toString(uri, { type: "svg", margin: 1, color: { dark: "#0d1117", light: "#f3f7ee" } }).then(setSvg);
  }, [uri]);
  return (
    <div className="vk-receive">
      <div className="vk-receive-head">
        <b>Receive USDG</b>
        <button className="vk-btn vk-btn-quiet" aria-label="Close" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="vk-receive-body">
        <div className="vk-qr" aria-label="QR code with an EIP-681 USDG payment request" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="vk-receive-copy">
          <code className="vk-mono">{account}</code>
          <button className="vk-btn vk-btn-ghost" onClick={() => navigator.clipboard.writeText(account).then(() => toast("Address copied"))}>
            <Copy size={13} /> Copy address
          </button>
          <p>
            USDG on {config?.chainName}. Have a payer, an employer or an exchange withdrawal send here directly.
            Topping up every app account from one wallet links them on-chain; on mainnet, route top-ups through a
            privacy pool (0xbow Privacy Pools or Railgun on Arbitrum One). No privacy pool runs on Arbitrum Sepolia.
          </p>
        </div>
      </div>
    </div>
  );
}

function AccountCard({ app, state }: { app: DemoApp; state?: AccountState }) {
  const { client, config, refreshAccounts } = useVeraKey();
  const [busy, setBusy] = useState<null | "deploy" | "fund">(null);
  const [receiving, setReceiving] = useState(false);
  const link = state && config ? explorerAddress(config, state.address) : null;

  const act = async (kind: "deploy" | "fund") => {
    if (!client || !state) return;
    setBusy(kind);
    try {
      if (kind === "deploy") {
        await client.ensureAccount(app.appId);
        toast.success(`${app.name} account deployed`);
      } else {
        if (!state.deployed) await client.ensureAccount(app.appId);
        await client.requestDemoFunds(state.address);
        toast.success(`Sent demo USDG to ${app.name}`);
      }
      await refreshAccounts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className={`vk-account vk-tone-${app.tone}`}>
      <div className="vk-account-head">
        <div className="vk-account-name">
          {app.name}
          <small>{app.tagline}</small>
        </div>
        <span className={`vk-status ${state?.deployed ? "is-live" : ""}`} title="The address is fixed before deployment (CREATE2), so it can receive USDG right away.">
          <i /> {state ? (state.deployed ? "Deployed" : "Not deployed") : "…"}
        </span>
      </div>
      <div className="vk-balance">
        <strong>{state ? formatUsdg(state.balance) : "—"}</strong>
        <span>USDG</span>
      </div>
      <div className="vk-facts">
        <div className="vk-fact">
          <span>Address</span>
          {state ? (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              {link ? <a href={link} target="_blank" rel="noreferrer">{shortHex(state.address)}</a> : <code>{shortHex(state.address)}</code>}
              <button
                className="vk-btn vk-btn-quiet"
                style={{ minHeight: 20, padding: 0 }}
                aria-label="Copy address"
                onClick={() => navigator.clipboard.writeText(state.address).then(() => toast("Address copied"))}
              >
                <Copy size={12} />
              </button>
            </span>
          ) : <code>…</code>}
        </div>
        <div className="vk-fact">
          <span>Owner nullifier</span>
          <code title={state ? `0x${state.nullifier.toString(16)}` : ""}>{state ? shortHex(`0x${state.nullifier.toString(16).padStart(64, "0")}`, 8, 6) : "…"}</code>
        </div>
        <div className="vk-fact">
          <span>Nonce · owners</span>
          <code>{state ? `${state.nonce} · ${state.ownerCount}` : "…"}</code>
        </div>
      </div>
      <div className="vk-account-actions">
        {state && !state.deployed ? (
          <button className="vk-btn vk-btn-ghost" disabled={!!busy} onClick={() => act("deploy")}>
            {busy === "deploy" ? <span className="vk-spinner" /> : <Rocket size={13} />} Deploy
          </button>
        ) : (
          <Link href={`/app/pay?from=${app.key}`} className="vk-btn vk-btn-primary" style={{ textDecoration: "none" }}>
            <ArrowUpRight size={13} /> Pay
          </Link>
        )}
        <button className="vk-btn vk-btn-ghost" disabled={!!busy || !state} onClick={() => act("fund")}>
          {busy === "fund" ? <span className="vk-spinner" /> : <Coins size={13} />} Demo USDG
        </button>
        <button className="vk-btn vk-btn-ghost" disabled={!state} onClick={() => setReceiving(open => !open)}>
          <ArrowDownLeft size={13} /> Receive
        </button>
      </div>
      {receiving && state && <ReceivePanel account={state.address} onClose={() => setReceiving(false)} />}
    </article>
  );
}

/**
 * The same passkey's account in another app, derived here without any transaction. Side by side with
 * Pay, it shows what the chain sees: two addresses and two nullifiers with nothing in common.
 */
function SecondAppCard({ pay }: { pay?: AccountState }) {
  const { client, session } = useVeraKey();
  const [derived, setDerived] = useState<{ address: Address; nullifier: bigint } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      if (!client || !session) return;
      const nullifier = await client.nullifier(SECOND_APP.appId);
      const address = await client.predictAddress(SECOND_APP.appId, nullifier);
      if (live) setDerived({ address, nullifier });
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [client, session]);
  const hex = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
  return (
    <section className="vk-panel">
      <div className="vk-panel-head"><span>Same passkey, another app</span><span>derived here · no transaction</span></div>
      <div className="vk-panel-body" style={{ padding: 0 }}>
        <table className="vk-matrix">
          <thead>
            <tr><th>On-chain</th><th>Pay</th><th>{SECOND_APP.name}</th></tr>
          </thead>
          <tbody>
            <tr><td>Account address</td><td className="vk-mono">{pay ? shortHex(pay.address) : "…"}</td><td className="vk-mono">{derived ? shortHex(derived.address) : "…"}</td></tr>
            <tr><td>Owner nullifier</td><td className="vk-mono">{pay ? shortHex(hex(pay.nullifier), 8, 6) : "…"}</td><td className="vk-mono">{derived ? shortHex(hex(derived.nullifier), 8, 6) : "…"}</td></tr>
            <tr><td>Passkey public key</td><td><span className="vk-tag is-private">none</span></td><td><span className="vk-tag is-private">none</span></td></tr>
            <tr><td>Shared on-chain field</td><td colSpan={2}><span className="vk-tag is-distinct">nothing links them</span></td></tr>
          </tbody>
        </table>
        <div style={{ padding: "12px 16px 16px", display: "grid", gap: 10 }}>
          <p style={{ margin: 0, color: "var(--vk-muted)", fontSize: 12, lineHeight: 1.6 }}>
            Only you can connect these two accounts, and only when you choose to: a disclosure proves to one
            party, with a fresh passkey approval, that both belong to this passkey.
          </p>
          <Link href="/app/disclose" className="vk-btn vk-btn-ghost" style={{ textDecoration: "none", justifySelf: "start" }}>
            <Link2 size={13} /> Link them for someone (by consent)
          </Link>
        </div>
      </div>
    </section>
  );
}

export function Accounts() {
  const { accounts, config, session, refreshAccounts, accountsLoading } = useVeraKey();
  const recent = activity.list().slice(0, 6);

  return (
    <div className="vk-stack">
      <section>
        <Kicker>Your account</Kicker>
        <h1 className="vk-title">One passkey.<br /><em>No key on-chain.</em></h1>
        <p className="vk-lede">
          <b>{session?.passkey.label}</b> controls this account through zero-knowledge proofs. The chain
          stores an owner ID (a nullifier derived from your passkey, its PRF secret and the app), never
          your public key. Another app gets a different address and nullifier from the same passkey, and
          without the PRF secret, which never leaves your authenticator, nothing on-chain connects them.
        </p>
      </section>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="vk-btn vk-btn-quiet" onClick={() => refreshAccounts()} disabled={accountsLoading}>
          <RefreshCw size={13} className={accountsLoading ? "vk-spin" : ""} /> Refresh balances
        </button>
      </div>

      <div className="vk-grid-2">
        {DEMO_APPS.map(app => (
          <AccountCard key={app.key} app={app} state={accounts[app.key]} />
        ))}
        <section className="vk-panel">
          <div className="vk-panel-head"><span>What the chain can see</span><span>this account</span></div>
          <div className="vk-panel-body" style={{ padding: 0 }}>
            <table className="vk-matrix">
              <thead>
                <tr><th>Field</th><th>On Arbitrum</th></tr>
              </thead>
              <tbody>
                <tr><td>Passkey public key</td><td><span className="vk-tag is-private">never on-chain</span></td></tr>
                <tr><td>Passkey signature</td><td><span className="vk-tag is-private">never on-chain</span></td></tr>
                <tr><td>PRF secret</td><td><span className="vk-tag is-private">never leaves the device</span></td></tr>
                <tr><td>Account address</td><td><span className="vk-tag is-distinct">different in every app</span></td></tr>
                <tr><td>Owner nullifier</td><td><span className="vk-tag is-distinct">different in every app</span></td></tr>
                <tr><td>Amounts, recipients, timing</td><td><span className="vk-tag is-shared">public</span> per account</td></tr>
                <tr><td>Factory, verifier, rpId, origin, relayer</td><td><span className="vk-tag is-shared">shared by every VeraKey user</span></td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <SecondAppCard pay={accounts.pay} />

      <div>
        <section className="vk-panel">
          <div className="vk-panel-head"><span>Recent activity</span><span>this browser</span></div>
          <div className="vk-panel-body">
            {recent.length === 0 ? (
              <p style={{ margin: 0, color: "var(--vk-muted)", fontSize: 12 }}>
                No payments yet. Get demo USDG on the account, then pay from it.
              </p>
            ) : (
              <div className="vk-activity">
                {recent.map(item => {
                  const href = config ? explorerTx(config, item.hash) : null;
                  const body = (
                    <>
                      <span>{item.kind}</span>
                      <span>{item.label}</span>
                      <span className="vk-mono" style={{ color: "var(--vk-lime)", fontSize: 11 }}>
                        {item.publicKeyOccurrences !== undefined ? `pk×${item.publicKeyOccurrences}` : ""}
                      </span>
                    </>
                  );
                  return href ? (
                    <a key={item.hash} href={href} target="_blank" rel="noreferrer">{body}</a>
                  ) : (
                    <div key={item.hash} className="vk-activity-row">{body}</div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
