import { VeraKeyClient, VeraKeyError } from "@verakey/sdk/client";
import { Fingerprint, KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { DEMO_APPS } from "@/lib/apps";
import { proverThreads, useVeraKey } from "@/state/VeraKeyProvider";
import { Kicker } from "./components";

type Check = { label: string; detail: string; state: "ok" | "warn" | "bad" | "pending"; value: string };

function useDeviceChecks(isolated: boolean, origin: string | undefined): Check[] {
  const [prf, setPrf] = useState<boolean | undefined | null>(null);
  useEffect(() => {
    VeraKeyClient.browserSupportsPrf().then(setPrf);
  }, []);
  const webauthn = typeof window !== "undefined" && "PublicKeyCredential" in window;
  // The factory binds every account to one exact origin, and the account checks it in clientDataJSON:
  // a passkey used anywhere else can sign, but nothing it signs will ever verify on-chain.
  const originOk = origin === undefined ? null : location.origin === origin;
  return [
    { label: "Passkeys (WebAuthn)", detail: "Face ID, Touch ID, Windows Hello or a security key", state: webauthn ? "ok" : "bad", value: webauthn ? "available" : "missing" },
    {
      label: "PRF extension",
      detail: "Salts your per-app IDs with a secret only the passkey can produce",
      state: prf === null ? "pending" : prf === false ? "bad" : prf ? "ok" : "warn",
      value: prf === null ? "checking" : prf === false ? "unsupported" : prf ? "supported" : "checked on first use",
    },
    { label: "Secure context", detail: "Passkeys only work over HTTPS or localhost", state: window.isSecureContext ? "ok" : "bad", value: window.isSecureContext ? "yes" : "no" },
    {
      label: "Origin",
      detail: originOk === false
        ? `This deployment's accounts only accept passkeys used on ${origin}. Open VeraKey there.`
        : "Your accounts are bound on-chain to this exact site",
      state: originOk === null ? "pending" : originOk ? "ok" : "bad",
      value: originOk === null ? "checking" : originOk ? location.host : "wrong site",
    },
    {
      label: "Multi-threaded proving",
      detail: "Cross-origin isolation lets the prover use every CPU core",
      state: isolated ? "ok" : "warn",
      value: isolated ? `${proverThreads()} threads` : "single thread",
    },
  ];
}

export function Onboarding() {
  const { config, passkeys, register, unlock, isolated, proverStatus } = useVeraKey();
  const checks = useDeviceChecks(isolated, config?.origin);
  const [busy, setBusy] = useState<null | "create" | "unlock">(null);
  const [error, setError] = useState<string | null>(null);
  const blocked = checks.some(c => c.state === "bad");

  const run = async (kind: "create" | "unlock", job: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(e instanceof VeraKeyError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="vk-ceremony">
      <section>
        <Kicker>Unlock VeraKey</Kicker>
        <h1 className="vk-title">One passkey.<br /><em>Accounts nothing links.</em></h1>
        <p className="vk-lede">
          Your passkey controls a separate smart account in each app. On Arbitrum, every action is
          authorized by a zero-knowledge proof made in this browser, so the chain never sees your
          passkey's public key, and no key material ties your accounts together.
        </p>
        <div className="vk-checks">
          {checks.map(check => (
            <div key={check.label} className={`vk-check is-${check.state}`}>
              <span className="vk-check-dot" />
              <span>
                {check.label}
                <small>{check.detail}</small>
              </span>
              <span className="vk-check-state">{check.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="vk-key-card">
        <span className="vk-glyph"><Fingerprint size={28} /></span>
        <h2 className="vk-h2" style={{ marginTop: 20 }}>
          {passkeys.length ? "Welcome back" : "Create your passkey"}
        </h2>
        <p className="vk-lede" style={{ fontSize: 13 }}>
          {passkeys.length
            ? "Unlock with the passkey you created before. Your accounts are derived again on this device; nothing is stored on a server."
            : "Your device asks twice: once to create the passkey, once to unlock it. The second prompt returns the private PRF secret that keeps your accounts unlinkable."}
        </p>

        <div className="vk-fanout" aria-hidden="true">
          {DEMO_APPS.map(app => (
            <div key={app.key} className={`vk-fanout-row vk-tone-${app.tone}`}>
              <b style={{ color: "var(--tone)" }}>{app.name.toUpperCase()}</b>
              <span style={{ color: "var(--vk-muted)" }}>own address · own nullifier · same passkey</span>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
          {passkeys.length > 0 && (
            <button className="vk-btn vk-btn-primary vk-btn-lg" disabled={!!busy || blocked} onClick={() => run("unlock", () => unlock())}>
              {busy === "unlock" ? <span className="vk-spinner" /> : <KeyRound size={16} />} Unlock with passkey
            </button>
          )}
          <button
            className={`vk-btn ${passkeys.length ? "vk-btn-ghost" : "vk-btn-primary"} vk-btn-lg`}
            disabled={!!busy || blocked}
            onClick={() => run("create", () => register(passkeys.length ? `Passkey ${passkeys.length + 1}` : "My passkey"))}
          >
            {busy === "create" ? <span className="vk-spinner" /> : <Fingerprint size={16} />}
            {passkeys.length ? "Create another passkey" : "Create passkey"}
          </button>
          {passkeys.length === 0 && (
            <button className="vk-btn vk-btn-quiet" disabled={!!busy || blocked} onClick={() => run("unlock", () => unlock())}>
              I already have a VeraKey passkey on another device
            </button>
          )}
        </div>

        {error && <div className="vk-note is-error" style={{ marginTop: 14 }}>{error}</div>}
        {busy && proverStatus !== "ready" && (
          <div className="vk-note" style={{ marginTop: 14 }}>
            <ShieldCheck size={15} /> Preparing the prover (about 8 MB, downloaded once from this site).
          </div>
        )}
      </section>
    </div>
  );
}
