import type { DisclosurePackage } from "@verakey/sdk/disclosure";
import type { ProofState } from "@verakey/sdk/client";
import { Copy, Download, FileCheck2, Link2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { DEMO_APPS, SECOND_APP } from "@/lib/apps";
import { shortHex } from "@/lib/format";
import { useVeraKey } from "@/state/VeraKeyProvider";
import { Kicker, ProofTimeline, RejectionNote } from "./components";

/** Where the verifier page finds the disclosure made in this browser. */
export const LAST_DISCLOSURE_KEY = "verakey.lastDisclosure.v1";

const TTL_OPTIONS = [
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86_400 },
  { label: "7 days", seconds: 7 * 86_400 },
];

function download(pkg: DisclosurePackage) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: "verakey-link-disclosure.json" });
  link.click();
  URL.revokeObjectURL(url);
}

export function Disclose() {
  const { client } = useVeraKey();
  const appA = DEMO_APPS[0];
  const appB = SECOND_APP;
  const [audience, setAudience] = useState("");
  const [nonce, setNonce] = useState("");
  const [ttl, setTtl] = useState(TTL_OPTIONS[1].seconds);
  const [state, setState] = useState<ProofState>({ status: "idle" });
  const [pkg, setPkg] = useState<DisclosurePackage | null>(null);
  const busy = state.status === "authenticating" || state.status === "proving";
  const nonceValid = nonce === "" || /^0x[0-9a-fA-F]{64}$/.test(nonce);

  const create = async () => {
    if (!client) return;
    setPkg(null);
    try {
      const made = await client.createDisclosure(
        {
          appIdA: appA.appId,
          appIdB: appB.appId,
          audience,
          nonce: nonce ? (nonce as `0x${string}`) : undefined,
          ttlSeconds: ttl,
          labels: { appA: appA.name, appB: appB.name },
        },
        setState
      );
      setPkg(made);
      setState({ status: "idle" });
      try {
        localStorage.setItem(LAST_DISCLOSURE_KEY, JSON.stringify(made));
      } catch {
        // The verifier page can still take a pasted file.
      }
      toast.success("Disclosure ready");
    } catch {
      // The timeline shows the rejection.
    }
  };

  return (
    <div className="vk-grid-2">
      <section className="vk-stack">
        <div>
          <Kicker>Linkable by consent</Kicker>
          <h1 className="vk-title">Unlinkable by default.<br /><em>Linkable when you say so.</em></h1>
          <p className="vk-lede">
            Nothing on-chain connects your {appA.name} and {appB.name} accounts. When an auditor, an exchange or a
            regulator needs to know they are both yours, give them a disclosure: your passkey approves a statement
            naming both accounts, the audience and an expiry, and a zero-knowledge proof shows one passkey owns both,
            without revealing the key. You choose who gets it; nothing is published.
          </p>
        </div>

        <div className="vk-panel">
          <div className="vk-panel-head"><span>Statement</span><span>signed by your passkey</span></div>
          <div className="vk-panel-body vk-form">
            <div className="vk-quote">
              <div><span>Accounts</span><span>{appA.name} + {appB.name}</span></div>
            </div>
            <label className="vk-field">
              <span>For whom (audience)</span>
              <input className="vk-input" placeholder="compliance@exchange.example" value={audience} onChange={e => setAudience(e.target.value)} disabled={busy} />
            </label>
            <label className="vk-field">
              <span>Their request nonce (optional, 32 bytes hex)</span>
              <input className="vk-input is-mono" placeholder="0x… (a random one is used if empty)" value={nonce} onChange={e => setNonce(e.target.value.trim())} disabled={busy} spellCheck={false} />
            </label>
            <div className="vk-seg">
              {TTL_OPTIONS.map(option => (
                <button key={option.seconds} className={ttl === option.seconds ? "is-active" : ""} onClick={() => setTtl(option.seconds)} disabled={busy}>
                  Valid {option.label}
                </button>
              ))}
            </div>
            <button className="vk-btn vk-btn-primary vk-btn-lg" disabled={busy || !audience.trim() || !nonceValid || !client} onClick={create}>
              {busy ? <span className="vk-spinner" /> : <Link2 size={16} />} Approve disclosure with passkey
            </button>
          </div>
        </div>
      </section>

      <section className="vk-stack" style={{ position: "sticky", top: 98 }}>
        {state.status !== "idle" && (
          <div className="vk-panel">
            <div className="vk-panel-head"><span>Disclosure</span><span>{state.status}</span></div>
            <div className="vk-panel-body">
              <ProofTimeline state={state} offChain />
              {state.status === "rejected" && <div style={{ marginTop: 14 }}><RejectionNote state={state} /></div>}
            </div>
          </div>
        )}
        {pkg ? (
          <div className="vk-panel">
            <div className="vk-panel-head"><span>Ready to share</span><span>{Math.round(pkg.proof.length / 2 / 1024)} KB proof</span></div>
            <div className="vk-panel-body vk-form">
              <div className="vk-quote">
                <div><span>Audience</span><span>{pkg.statement.audience}</span></div>
                <div><span>{appA.name} nullifier</span><span className="vk-mono">{shortHex(pkg.statement.nullifierA, 8, 6)}</span></div>
                <div><span>{appB.name} nullifier</span><span className="vk-mono">{shortHex(pkg.statement.nullifierB, 8, 6)}</span></div>
                <div><span>Expires</span><span>{new Date(pkg.statement.expiresAt * 1000).toLocaleString()}</span></div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="vk-btn vk-btn-primary" onClick={() => download(pkg)}><Download size={14} /> Download</button>
                <button className="vk-btn vk-btn-ghost" onClick={() => navigator.clipboard.writeText(JSON.stringify(pkg)).then(() => toast("Disclosure copied"))}><Copy size={14} /> Copy</button>
                <Link href="/app/verify?from=last" className="vk-btn vk-btn-ghost" style={{ textDecoration: "none" }}><FileCheck2 size={14} /> Verify it as the audience would</Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="vk-note">
            The disclosure reveals only that these two accounts share an owner. It names its audience, so anyone
            checking it under another name sees it fail; it cannot move funds, and it stops being accepted after
            it expires.
          </div>
        )}
      </section>
    </div>
  );
}
