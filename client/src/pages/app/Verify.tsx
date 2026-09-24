import { verifyDisclosure, type DisclosurePackage, type DisclosureVerdict } from "@verakey/sdk/disclosure";
import { Check, FileCheck2, ShieldX, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { explorerAddress } from "@/lib/config";
import { shortHex } from "@/lib/format";
import { useVeraKey } from "@/state/VeraKeyProvider";
import { Kicker } from "./components";
import { LAST_DISCLOSURE_KEY } from "./Disclose";

/**
 * The audience's side of "linkable by consent". Needs no passkey and no session: it checks a disclosure
 * against this deployment, verifies the proof on-chain (eth_call to LinkHonkVerifier) and in this
 * browser (bb.js), and reads both accounts from the factory.
 */
export function Verify() {
  const { client, config } = useVeraKey();
  const search = useSearch();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<DisclosureVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (new URLSearchParams(search).get("from") !== "last") return;
    try {
      const stored = localStorage.getItem(LAST_DISCLOSURE_KEY);
      if (stored) setText(JSON.stringify(JSON.parse(stored), null, 2));
    } catch {
      // Nothing stored.
    }
  }, [search]);

  const verify = async () => {
    if (!client || !config) return;
    setBusy(true);
    setVerdict(null);
    setError(null);
    try {
      const pkg = JSON.parse(text) as DisclosurePackage;
      const linkProver = await client.linkProver().catch(() => undefined);
      setVerdict(
        await verifyDisclosure(pkg, {
          publicClient: client.publicClient as never,
          chainId: config.chainId,
          factory: config.contracts.factory,
          rpIdHash: config.rpIdHash,
          origin: config.origin,
          linkVerifier: config.contracts.linkVerifier,
          linkProver,
        })
      );
    } catch (e) {
      setError(e instanceof SyntaxError ? "That is not JSON. Paste the disclosure file's contents." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadFile = async (file?: File) => {
    if (file) setText(await file.text());
  };

  return (
    <div className="vk-grid-2">
      <section className="vk-stack">
        <div>
          <Kicker>Verify a disclosure</Kicker>
          <h1 className="vk-title">Check the link.<br /><em>Trust no one's word.</em></h1>
          <p className="vk-lede">
            For the party a VeraKey user chose to tell. No passkey or account needed: this page checks the statement,
            the passkey-signed client data and the zero-knowledge proof, then reads both accounts from the chain.
          </p>
        </div>
        <div className="vk-panel">
          <div className="vk-panel-head"><span>Disclosure</span><span>JSON</span></div>
          <div className="vk-panel-body vk-form">
            <textarea
              className="vk-input is-mono"
              style={{ minHeight: 180, resize: "vertical", fontSize: 11 }}
              placeholder='{"kind":"verakey-link-disclosure",…}'
              value={text}
              onChange={e => setText(e.target.value)}
              spellCheck={false}
            />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="vk-btn vk-btn-primary" disabled={busy || !text.trim() || !client} onClick={verify}>
                {busy ? <span className="vk-spinner" /> : <FileCheck2 size={14} />} Verify
              </button>
              <label className="vk-btn vk-btn-ghost" style={{ cursor: "pointer" }}>
                <Upload size={14} /> Open file
                <input type="file" accept="application/json,.json" hidden onChange={e => loadFile(e.target.files?.[0])} />
              </label>
            </div>
            {error && <div className="vk-note is-error">{error}</div>}
          </div>
        </div>
      </section>

      <section className="vk-stack" style={{ position: "sticky", top: 98 }}>
        {verdict ? (
          <div className="vk-panel" style={{ borderColor: verdict.valid ? "rgba(201,255,91,.45)" : "rgba(255,120,120,.45)" }}>
            <div className="vk-panel-head">
              <span>{verdict.valid ? "Valid: one passkey owns both accounts" : "Not valid"}</span>
              <span>{verdict.checks.filter(c => c.ok).length}/{verdict.checks.length} checks</span>
            </div>
            <div className="vk-panel-body" style={{ display: "grid", gap: 8 }}>
              {verdict.checks.map(c => (
                <div key={c.name} className="vk-verify-row">
                  <span className={c.ok ? "is-ok" : "is-bad"}>{c.ok ? <Check size={13} /> : <ShieldX size={13} />}</span>
                  <span>{c.name}{c.detail && !c.ok ? <small>{c.detail}</small> : null}</span>
                </div>
              ))}
              {verdict.accounts && (
                <div className="vk-quote" style={{ marginTop: 8 }}>
                  {(["a", "b"] as const).map(side => {
                    const account = verdict.accounts![side];
                    const href = config ? explorerAddress(config, account.address) : null;
                    return (
                      <div key={side}>
                        <span>Account {side.toUpperCase()} {account.deployed ? "" : "(not deployed yet)"}</span>
                        <span className="vk-mono">
                          {href ? <a href={href} target="_blank" rel="noreferrer">{shortHex(account.address)}</a> : shortHex(account.address)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="vk-note">
            A valid disclosure proves that one passkey owns both accounts and approved this statement for this
            audience before its expiry. It says nothing about the person, and it cannot move funds.
          </div>
        )}
      </section>
    </div>
  );
}
