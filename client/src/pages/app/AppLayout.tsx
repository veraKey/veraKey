import type { NetworkConfig } from "@shared/api";
import { Lock } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { BrandMark } from "@/components/BrandMark";
import { COMPACT_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { useVeraKey } from "@/state/VeraKeyProvider";
import { Onboarding } from "./Onboarding";

const NAV = [
  { href: "/app", label: "Accounts", no: "01" },
  { href: "/app/pay", label: "Pay", no: "02" },
  { href: "/app/policy", label: "Policy", no: "03" },
  { href: "/app/recovery", label: "Recovery", no: "04" },
  { href: "/app/disclose", label: "Disclose", no: "05" },
  { href: "/docs", label: "Developer docs", short: "Docs", no: "06" },
];

export interface AppTopProps {
  network?: Pick<NetworkConfig, "chainId" | "chainName">;
  prover: { cls: string; text: string };
  session: { label: string; credentialId: string } | null;
  onLock?: () => void;
}

/** The app's top bar: brand, network, prover status and the unlocked passkey. */
export function AppTop({ network, prover, session, onLock }: AppTopProps) {
  return (
    <header className="vk-top">
      <div className="vk-top-inner">
        <Link href="/" className="brand-lockup" aria-label="VeraKey home">
          <BrandMark />
          <span className="brand-wordmark">Vera<span>Key</span></span>
        </Link>
        {network && (
          <span className="vk-pill is-network" title={`chain ${network.chainId}`}>
            <i /> {network.chainName}
          </span>
        )}
        <span className={`vk-pill is-prover ${prover.cls}`} title={prover.text}><i /> {prover.text}</span>
        <span className="vk-top-spacer" />
        {session ? (
          <span className="vk-session">
            <span>
              <b>{session.label}</b> <small>{session.credentialId.slice(0, 8)}</small>
            </span>
            <button className="vk-btn vk-btn-quiet" onClick={onLock} aria-label="Lock">
              <Lock size={13} /> Lock
            </button>
          </span>
        ) : (
          <span className="vk-pill is-off"><i /> Locked</span>
        )}
      </div>
    </header>
  );
}

/** The app's pages: a sidebar on wide screens, tabs in the phone layout. */
export function AppNav({ location }: { location: string }) {
  return (
    <nav className="vk-nav" aria-label="App">
      {NAV.map(item => (
        <Link key={item.href} href={item.href} className={location === item.href ? "is-active" : ""}>
          <span className="vk-nav-no">{item.no}</span>
          <span className={`vk-nav-label${item.short ? " has-short" : ""}`}>{item.label}</span>
          {item.short && <span className="vk-nav-short">{item.short}</span>}
        </Link>
      ))}
      <p className="vk-nav-foot">
        Proofs are generated in this browser. The relayer only ever receives a proof and public
        inputs.
      </p>
    </nav>
  );
}

export function AppLayout({ children, requiresSession = true }: { children: ReactNode; requiresSession?: boolean }) {
  const { config, configError, session, proverStatus, isolated, lock, warmProver, client } = useVeraKey();
  const [location] = useLocation();
  const compact = useMediaQuery(COMPACT_QUERY);

  // Start downloading the prover and CRS as soon as the app opens: the first proof is then warm.
  useEffect(() => {
    if (client) warmProver();
  }, [client, warmProver]);

  const prover =
    proverStatus === "ready" ? { cls: "", text: isolated ? "Prover ready · multi-thread" : "Prover ready · 1 thread" }
      : proverStatus === "error" ? { cls: "is-warn", text: "Prover failed to load" }
        : { cls: "is-off", text: "Loading prover…" };

  return (
    <div className={`vk-app${compact ? " vk-compact" : ""}`}>
      <AppTop
        network={config ?? undefined}
        prover={prover}
        session={session ? { label: session.passkey.label, credentialId: session.passkey.credentialId } : null}
        onLock={lock}
      />

      <div className="vk-layout">
        <AppNav location={location} />
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
