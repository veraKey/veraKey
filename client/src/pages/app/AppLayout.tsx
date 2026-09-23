import { Lock } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { BrandMark } from "@/components/BrandMark";
import { useVeraKey } from "@/state/VeraKeyProvider";
import { Onboarding } from "./Onboarding";

const NAV = [
  { href: "/app", label: "Accounts", no: "01" },
  { href: "/app/pay", label: "Pay", no: "02" },
  { href: "/app/policy", label: "Policy", no: "03" },
  { href: "/app/recovery", label: "Recovery", no: "04" },
  { href: "/docs", label: "Developer docs", no: "05" },
];

export function AppLayout({ children, requiresSession = true }: { children: ReactNode; requiresSession?: boolean }) {
  const { config, configError, session, proverStatus, isolated, lock, warmProver, client } = useVeraKey();
  const [location] = useLocation();

  // Start downloading the prover and CRS as soon as the app opens: the first proof is then warm.
  useEffect(() => {
    if (client) warmProver();
  }, [client, warmProver]);

  const proverPill =
    proverStatus === "ready" ? { cls: "", text: isolated ? "Prover ready · multi-thread" : "Prover ready · 1 thread" }
      : proverStatus === "error" ? { cls: "is-warn", text: "Prover failed to load" }
        : { cls: "is-off", text: "Loading prover…" };

  return (
    <div className="vk-app">
      <header className="vk-top">
        <div className="vk-top-inner">
          <Link href="/" className="brand-lockup" aria-label="VeraKey home">
            <BrandMark />
            <span className="brand-wordmark">Vera<span>Key</span></span>
          </Link>
          {config && (
            <span className="vk-pill is-network" title={`chain ${config.chainId}`}>
              <i /> {config.chainName}
            </span>
          )}
          <span className={`vk-pill ${proverPill.cls}`}><i /> {proverPill.text}</span>
          <span className="vk-top-spacer" />
          {session ? (
            <span className="vk-session">
              <span>
                <b>{session.passkey.label}</b> <small>{session.passkey.credentialId.slice(0, 8)}</small>
              </span>
              <button className="vk-btn vk-btn-quiet" onClick={lock} aria-label="Lock">
                <Lock size={13} /> Lock
              </button>
            </span>
          ) : (
            <span className="vk-pill is-off"><i /> Locked</span>
          )}
        </div>
      </header>

      <div className="vk-layout">
        <nav className="vk-nav" aria-label="App">
          {NAV.map(item => (
            <Link key={item.href} href={item.href} className={location === item.href ? "is-active" : ""}>
              <span>{item.no}</span>
              {item.label}
            </Link>
          ))}
          <p className="vk-nav-foot">
            Proofs are generated in this browser. The relayer only ever receives a proof and public
            inputs.
          </p>
        </nav>
        <main className="vk-main">
          {configError ? (
            <div className="vk-note is-error">
              The VeraKey relayer is unreachable ({configError}). Start it with <code>pnpm dev</code>.
            </div>
          ) : !config ? (
            <div className="vk-note"><span className="vk-spinner" /> Connecting to the relayer…</div>
          ) : requiresSession && !session ? (
            <Onboarding />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
