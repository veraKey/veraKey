// Landing-page hero: one payment through the real /app flow, shown on a phone and in the dashboard
// at the same time. The dashboard renders the app's own components; the phone shows the same flow as
// it looks on iOS. It is an illustration: the numbers are measured, the transaction is not real.
import type { ProofState } from "@verakey/sdk/client";
import { BatteryFull, Check, KeyRound, Lock, LockKeyhole, RotateCw, ScanFace, Signal, Wifi } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { TransactionReceipt } from "viem";
import { ProofReceipt, ProofTimeline, useNow, type ReceiptData } from "@/pages/app/components";
import { BrandMark } from "./BrandMark";

type Phase = "idle" | "tap" | "sheet" | "faceid" | "proving" | "relaying" | "confirming" | "paid";

/** The payment, beat by beat (ms). Proving lasts the 2.3 s measured in Chrome with 8 threads. */
const SCRIPT: readonly (readonly [Phase, number])[] = [
  ["idle", 1500],
  ["tap", 450],
  ["sheet", 950],
  ["faceid", 1100],
  ["proving", 2300],
  ["relaying", 900],
  ["confirming", 1000],
  ["paid", 4200],
];
const PROVING_MS = 2300;
/** Layout sizes of the two screens before they are scaled into their frames. */
const DESKTOP = { width: 1180, height: 760 };
const PHONE = { width: 390, height: 844 };

// Illustrative values: the receipt shows the hash without an explorer link.
const TX_HASH = "0x5c0e9a2f41d7b3e8c6a90f12d4b7e35a8c1f6d09e2b47a3c5d8e1f60a9b2c7d4";
const BLOCK = 311_900_418n;
const RECEIPT: ReceiptData = {
  title: "Paid 2.00 USDG",
  hash: TX_HASH,
  gasUsed: 4_171_302n,
  provingMs: PROVING_MS,
  publicKeyOccurrences: 0,
  proofBytes: 9152,
  rows: [["To", "Demo merchant"], ["Relayer fee", "0.02 USDG"]],
};
const NO_EXPLORER = { explorerUrl: null };
const NAV = ["Accounts", "Pay", "Policy", "Recovery", "Developer docs"];

function proofState(phase: Phase, startedAt: number): ProofState {
  switch (phase) {
    case "idle":
    case "tap":
      return { status: "idle" };
    case "sheet":
    case "faceid":
      return { status: "authenticating" };
    case "proving":
      return { status: "proving", startedAt };
    case "relaying":
      return { status: "relaying", provingMs: PROVING_MS };
    case "confirming":
      return { status: "confirming", provingMs: PROVING_MS, hash: TX_HASH };
    case "paid":
      // The timeline reads only the block number from the receipt.
      return { status: "verified", provingMs: PROVING_MS, hash: TX_HASH, receipt: { blockNumber: BLOCK } as TransactionReceipt, publicKeyOccurrences: 0 };
  }
}

/** Plays SCRIPT on a loop while `root` is on screen; holds the final frame when motion is reduced. */
function usePlayback(root: RefObject<HTMLElement | null>) {
  const [reduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [step, setStep] = useState(() => ({ index: reduced ? SCRIPT.length - 1 : 0, startedAt: Date.now() }));
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (reduced || !onScreen) return;
    const timer = window.setTimeout(
      () => setStep(({ index }) => ({ index: (index + 1) % SCRIPT.length, startedAt: Date.now() })),
      SCRIPT[step.index][1]
    );
    return () => window.clearTimeout(timer);
  }, [step, onScreen, reduced]);

  return { phase: SCRIPT[step.index][0], startedAt: step.startedAt };
}

/** The scale that fits a screen laid out `width` CSS px wide into the element's current width. */
function useFit(width: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  return [ref, { "--s": scale } as CSSProperties] as const;
}

export function HeroShowcase() {
  const root = useRef<HTMLDivElement>(null);
  const { phase, startedAt } = usePlayback(root);
  const [viewport, viewportScale] = useFit(DESKTOP.width);
  const [screen, screenScale] = useFit(PHONE.width);

  return (
    <div ref={root} className={`hero-visual hero-showcase is-${phase}`}>
      <p className="sr-only">
        Illustration of a VeraKey payment: Face ID approves 2 USDG on a phone, the browser proves it in
        zero knowledge, and the dashboard shows the proof verified on Arbitrum with the public key
        appearing zero times on-chain.
      </p>
      <div className="showcase-glow" aria-hidden="true" />

      <div className="showcase-browser" aria-hidden="true">
        <div className="browser-bar">
          <span className="browser-dots"><i /><i /><i /></span>
          <span className="browser-url"><Lock size={10} /> verakey.mdloglabs.org<span>/app/pay</span></span>
          <span className="browser-tag">Preview</span>
        </div>
        <div ref={viewport} className="browser-viewport">
          <div className="browser-canvas" style={viewportScale}>
            <Dashboard phase={phase} startedAt={startedAt} />
          </div>
        </div>
      </div>

      <div className="showcase-phone" aria-hidden="true">
        <div ref={screen} className="phone-screen">
          <div className="phone-canvas" style={screenScale}>
            <PhoneApp phase={phase} startedAt={startedAt} />
          </div>
        </div>
      </div>

      {phase === "relaying" && (
        <span className="showcase-packet" aria-hidden="true"><LockKeyhole size={11} /> proof · 9,152 B · no key</span>
      )}
      <p className="showcase-caption" aria-hidden="true">Illustration of the /app flow · proof time measured in Chrome</p>
    </div>
  );
}

/** The /app/pay page, built from the app's own classes and components. */
function Dashboard({ phase, startedAt }: { phase: Phase; startedAt: number }) {
  const state = proofState(phase, startedAt);
  const paid = phase === "paid";
  const busy = state.status !== "idle" && state.status !== "verified";

  return (
    <div className="vk-app showcase-app">
      <header className="vk-top">
        <div className="vk-top-inner">
          <span className="brand-lockup"><BrandMark /><span className="brand-wordmark">Vera<span>Key</span></span></span>
          <span className="vk-pill is-network"><i /> Arbitrum Sepolia</span>
          <span className="vk-pill"><i /> Prover ready · multi-thread</span>
          <span className="vk-top-spacer" />
          <span className="vk-session">
            <span><b>iPhone passkey</b> <small>a41f9c02</small></span>
            <span className="vk-btn vk-btn-quiet"><Lock size={13} /> Lock</span>
          </span>
        </div>
      </header>

      <div className="vk-layout showcase-page">
        <nav className="vk-nav">
          {NAV.map((label, i) => (
            <a key={label} className={label === "Pay" ? "is-active" : ""}><span>0{i + 1}</span>{label}</a>
          ))}
          <p className="vk-nav-foot">Proofs are generated in this browser. The relayer only ever receives a proof and public inputs.</p>
        </nav>

        <main className="vk-main">
          <div className="vk-grid-2">
            <section className="vk-stack">
              <div>
                <div className="vk-kicker">Pay with a passkey</div>
                <h1 className="vk-title">Face ID in.<br /><em>A proof out.</em></h1>
              </div>
              <div className="vk-panel vk-tone-lime">
                <div className="vk-panel-head"><span>Payment intent</span><span>USDG · Arbitrum Sepolia</span></div>
                <div className="vk-panel-body vk-form">
                  <div className="vk-field">
                    <span>From account</span>
                    <div className="vk-input is-mono showcase-field">Pay · <b className={paid ? "is-updated" : ""}>{paid ? "2.98" : "5.00"}</b> USDG</div>
                  </div>
                  <div className="vk-field">
                    <span>Recipient</span>
                    <div className="vk-input is-mono showcase-field">0x841C…590A · demo merchant</div>
                  </div>
                  <div className="vk-field">
                    <span>Amount (USDG)</span>
                    <div className="vk-input is-amount showcase-field">2.00</div>
                  </div>
                  <div className="vk-quote">
                    <div><span>Relayer fee (paid in USDG, no ETH needed)</span><span className="vk-mono">0.02</span></div>
                    <div><span>Per-payment cap</span><span className="vk-mono">10.00</span></div>
                    <div><span>Left today</span><span className="vk-mono">{paid ? "22.98" : "25.00"}</span></div>
                  </div>
                  <span className="vk-btn vk-btn-primary vk-btn-lg">
                    {busy ? <span className="vk-spinner" /> : <ScanFace size={17} />} Approve with passkey
                  </span>
                </div>
              </div>
            </section>

            <section className="vk-stack">
              <div className="vk-panel">
                <div className="vk-panel-head"><span>Authorization</span><span>{state.status === "idle" ? "ready" : state.status}</span></div>
                <div className="vk-panel-body"><ProofTimeline state={state} /></div>
              </div>
              {paid && <ProofReceipt receipt={RECEIPT} config={NO_EXPLORER} />}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

/** The same payment in mobile Safari on an iPhone, with the system passkey sheet. */
function PhoneApp({ phase, startedAt }: { phase: Phase; startedAt: number }) {
  const now = useNow(phase === "proving");
  const provingMs = phase === "proving" ? Math.min(now - startedAt, PROVING_MS) : PROVING_MS;
  const paid = phase === "paid";

  return (
    <div className="vk-app phone-app">
      <div className="ios-status">
        <span className="ios-time">9:41</span>
        <span className="ios-island" />
        <span className="ios-icons"><Signal size={17} strokeWidth={2.6} /><Wifi size={17} strokeWidth={2.6} /><BatteryFull size={24} strokeWidth={1.8} /></span>
      </div>

      <div className="phone-page">
        <div className="phone-top">
          <span className="brand-lockup"><BrandMark /><span className="brand-wordmark">Vera<span>Key</span></span></span>
          <span className="vk-pill is-network"><i /> Arbitrum Sepolia</span>
        </div>
        <div className="vk-kicker">Pay with a passkey</div>
        <h2 className="phone-title">Face ID in.<br /><em>A proof out.</em></h2>

        <div className="phone-card vk-tone-lime">
          <div className="phone-card-head"><span>Pay account</span><b className={paid ? "is-updated" : ""}>{paid ? "2.98" : "5.00"} USDG</b></div>
          <div className="phone-amount"><strong>2.00</strong><span>USDG</span></div>
          <div className="vk-quote">
            <div><span>To</span><span>Demo merchant</span></div>
            <div><span>Relayer fee</span><span className="vk-mono">0.02 USDG</span></div>
            <div><span>Network</span><span>Arbitrum Sepolia</span></div>
          </div>
        </div>

        <span className={`vk-btn vk-btn-primary vk-btn-lg phone-cta ${phase === "tap" ? "is-pressed" : ""}`}>
          <ScanFace size={19} /> Approve with passkey
          {phase === "tap" && <span className="phone-tap" />}
        </span>
        <div className="phone-privacy">
          <div><span>Leaves this phone</span><b>a 9,152-byte proof</b></div>
          <div><span>Stays on it</span><b><LockKeyhole size={12} /> key · signature · PRF secret</b></div>
        </div>
      </div>

      {(phase === "sheet" || phase === "faceid") && <PasskeySheet scanning={phase === "faceid"} />}
      {(phase === "proving" || phase === "relaying" || phase === "confirming") && <ProvingCard phase={phase} provingMs={provingMs} />}
      {paid && <PaidScreen />}

      <div className="ios-safari">
        <span className="ios-url"><span className="ios-aa">AA</span><span><Lock size={11} /> verakey.mdloglabs.org</span><RotateCw size={13} /></span>
        <span className="ios-home" />
      </div>
    </div>
  );
}

function PasskeySheet({ scanning }: { scanning: boolean }) {
  return (
    <>
      <span className="ios-dim" />
      <div className="ios-sheet">
        <span className="ios-grabber" />
        <div className="ios-sheet-site"><span className="ios-sheet-icon"><KeyRound size={20} /></span>verakey.mdloglabs.org</div>
        <b className="ios-sheet-title">Sign in with your passkey?</b>
        <p className="ios-sheet-text">Use Face ID to sign in to “verakey.mdloglabs.org”.</p>
        <div className={`ios-faceid ${scanning ? "is-scanning" : ""}`}>
          <ScanFace className="ios-faceid-glyph" size={62} strokeWidth={1.3} />
          <span className="ios-faceid-done"><Check size={36} strokeWidth={2.6} /></span>
        </div>
        <span className="ios-sheet-button">{scanning ? "Face ID" : "Continue"}</span>
      </div>
    </>
  );
}

function ProvingCard({ phase, provingMs }: { phase: Phase; provingMs: number }) {
  const [title, detail] =
    phase === "proving" ? ["Proving on this phone", "UltraHonk · in the browser"]
      : phase === "relaying" ? ["Sending the proof", "Gasless · fee paid in USDG"]
        : ["Confirming on Arbitrum", "The Stylus account verifies it"];
  return (
    <div className="phone-overlay">
      <div className="phone-ring">
        <svg viewBox="0 0 120 120">
          <circle className="phone-ring-track" cx="60" cy="60" r="52" />
          <circle className="phone-ring-fill" cx="60" cy="60" r="52" pathLength="100" style={{ strokeDashoffset: 100 - (100 * provingMs) / PROVING_MS }} />
        </svg>
        <strong>{(provingMs / 1000).toFixed(1)}<small>s</small></strong>
      </div>
      <b className="phone-overlay-title">{title} {phase !== "proving" && <span className="vk-spinner" />}</b>
      <span className="phone-overlay-detail">{detail}</span>
      <ul className="phone-secrets">
        <li><LockKeyhole size={13} /> Public key</li>
        <li><LockKeyhole size={13} /> Signature</li>
        <li><LockKeyhole size={13} /> PRF secret</li>
      </ul>
      <span className="phone-overlay-detail">stay on this phone</span>
    </div>
  );
}

function PaidScreen() {
  return (
    <div className="phone-overlay is-paid">
      <span className="phone-check"><Check size={46} strokeWidth={2.4} /></span>
      <b className="phone-overlay-title">Paid</b>
      <strong className="phone-paid-amount">2.00 USDG</strong>
      <span className="phone-overlay-detail">to Demo merchant</span>
      <div className="vk-quote phone-paid-quote">
        <div><span>Proof on this phone</span><span className="vk-mono">2.3 s</span></div>
        <div><span>Relayer fee</span><span className="vk-mono">0.02 USDG</span></div>
        <div><span>Public key on-chain</span><span className="vk-mono phone-zero">0×</span></div>
      </div>
    </div>
  );
}
