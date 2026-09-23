import type { AccountState } from "@verakey/sdk/client";
import { ArrowUpRight, Coins, Copy, RefreshCw, Rocket } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { DEMO_APPS, type DemoApp } from "@/lib/apps";
import { explorerAddress, explorerTx } from "@/lib/config";
import { formatUsdg, shortHex } from "@/lib/format";
import { activity } from "@/lib/history";
import { useVeraKey } from "@/state/VeraKeyProvider";
import { Kicker } from "./components";

function AccountCard({ app, state }: { app: DemoApp; state?: AccountState }) {
  const { client, config, refreshAccounts } = useVeraKey();
  const [busy, setBusy] = useState<null | "deploy" | "fund">(null);
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
      </div>
    </article>
  );
}

export function Accounts() {
  const { accounts, config, session, refreshAccounts, accountsLoading } = useVeraKey();
  const recent = activity.list().slice(0, 6);

  return (
    <div className="vk-stack">
      <section>
        <Kicker>Your accounts</Kicker>
        <h1 className="vk-title">Three apps.<br /><em>No shared key on-chain.</em></h1>
        <p className="vk-lede">
          <b>{session?.passkey.label}</b> controls each of these accounts. Each one has its own address and
          its own owner ID (a nullifier derived from your passkey, its PRF secret and the app). Without
          the PRF secret, which never leaves your authenticator, nothing on-chain connects them.
        </p>
      </section>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="vk-btn vk-btn-quiet" onClick={() => refreshAccounts()} disabled={accountsLoading}>
          <RefreshCw size={13} className={accountsLoading ? "vk-spin" : ""} /> Refresh balances
        </button>
      </div>

      <div className="vk-grid-3">
        {DEMO_APPS.map(app => (
          <AccountCard key={app.key} app={app} state={accounts[app.key]} />
        ))}
      </div>

      <div className="vk-grid-2">
        <section className="vk-panel">
          <div className="vk-panel-head"><span>What the chain can see</span><span>per account</span></div>
          <div className="vk-panel-body" style={{ padding: 0 }}>
            <table className="vk-matrix">
              <thead>
                <tr><th>Field</th><th>Across your 3 accounts</th></tr>
              </thead>
              <tbody>
                <tr><td>Passkey public key</td><td><span className="vk-tag is-private">never on-chain</span></td></tr>
                <tr><td>Passkey signature</td><td><span className="vk-tag is-private">never on-chain</span></td></tr>
                <tr><td>PRF secret</td><td><span className="vk-tag is-private">never leaves the device</span></td></tr>
                <tr><td>Account address</td><td><span className="vk-tag is-distinct">distinct</span></td></tr>
                <tr><td>Owner nullifier</td><td><span className="vk-tag is-distinct">distinct</span></td></tr>
                <tr><td>Amounts, recipients, timing</td><td><span className="vk-tag is-shared">public</span> per account</td></tr>
                <tr><td>Factory, verifier, rpId, origin, relayer</td><td><span className="vk-tag is-shared">shared by every VeraKey user</span></td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="vk-panel">
          <div className="vk-panel-head"><span>Recent activity</span><span>this browser</span></div>
          <div className="vk-panel-body">
            {recent.length === 0 ? (
              <p style={{ margin: 0, color: "var(--vk-muted)", fontSize: 12 }}>
                No payments yet. Get demo USDG on an account, then pay from it.
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
