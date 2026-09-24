// Landing-page hero: one payment through the app, on a phone and in the dashboard at the same time.
// Both screens render the app's own views (AppTop, AppNav, PayDesktop, PayMobile) with a scripted
// payment, so the hero shows exactly what /app/pay shows. Only the iOS frame and the passkey sheet are
// drawn here: on a real phone the system draws them. The numbers are measured; the payment is not real.
import type { ProofState } from "@verakey/sdk/client";
import { BatteryFull, Check, KeyRound, Lock, LockKeyhole, RotateCw, ScanFace, Signal, Wifi } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { TransactionReceipt } from "viem";
import { shortHex } from "@/lib/format";
import { AppNav, AppTop } from "@/pages/app/AppLayout";
import type { ReceiptData } from "@/pages/app/components";
import { PROOF_BYTES, PayDesktop, PayMobile, type PayViewProps } from "@/pages/app/PayView";

type Phase = "idle" | "tap" | "sheet" | "faceid" | "proving" | "relaying" | "confirming" | "paid";

/** The payment, beat by beat (ms). Proving lasts the 1.85 s measured in Chrome with 8 threads. */
const SCRIPT: readonly (readonly [Phase, number])[] = [
  ["idle", 1500],
  ["tap", 450],
  ["sheet", 950],
  ["faceid", 1100],
  ["proving", 1850],
  ["relaying", 900],
  ["confirming", 1000],
  ["paid", 4200],
];
const PROVING_MS = 1850;
/** CSS widths the two screens are laid out at before they are scaled into their frames. */
const DESKTOP_WIDTH = 1180;
const PHONE_WIDTH = 390;

const NETWORK = { chainId: 421614, chainName: "Arbitrum Sepolia" };
const PROVER = { cls: "", text: "Prover ready · multi-thread" };
const SESSION = { label: "iPhone passkey", credentialId: "a41f9c02" };
/** The live relayer, which the app pays as its demo merchant. */
const MERCHANT = "0x841CE1e27407EB9Bb6D14AC91374DAE60B41590A";
// Illustrative values: the receipt shows the hash without an explorer link.
const ACCOUNT = "0x7a3e5c1f9b2d4e6a8c0b1d3f5e7a9c2b4d6fc2b4";
const TX_HASH = "0x5c0e9a2f41d7b3e8c6a90f12d4b7e35a8c1f6d09e2b47a3c5d8e1f60a9b2c7d4";
const BLOCK = 311_900_418n;
const RECEIPT: ReceiptData = {
  title: "Paid 2.00 USDG",
  hash: TX_HASH,
  gasUsed: 1_021_759n,
  provingMs: PROVING_MS,
  publicKeyOccurrences: 0,
  proofBytes: PROOF_BYTES,
  rows: [
    ["From", <code key="f">Pay · {shortHex(ACCOUNT)}</code>],
    ["To", <code key="t">{shortHex(MERCHANT)} · demo merchant</code>],
    ["Relayer fee", <code key="fee">0.02 USDG, signed into the approval</code>],
  ],
};

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

/** The Pay view's props at `phase`: a funded account paying the demo merchant 2 USDG. */
function demoView(phase: Phase, startedAt: number): PayViewProps {
  const paid = phase === "paid";
  return {
    accountName: "Pay",
    tone: "lime",
    balance: paid ? 2_980_000n : 5_000_000n,
    merchant: MERCHANT,
    recipient: "",
    amount: "2",
    fee: 20_000n,
    perTxCap: 10_000_000n,
    remainingToday: paid ? 22_980_000n : 25_000_000n,
    chainName: NETWORK.chainName,
    state: proofState(phase, startedAt),
    receipt: paid ? RECEIPT : null,
    explorer: { explorerUrl: null },
    problem: null,
    overCap: false,
    onDone: () => {}, // shows the paid screen's Done button, as in the app
  };
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
  const [viewport, viewportScale] = useFit(DESKTOP_WIDTH);
  const [screen, screenScale] = useFit(PHONE_WIDTH);
  const view = demoView(phase, startedAt);

  return (
    <div ref={root} className={`hero-visual hero-showcase is-${phase}`}>
      <p className="sr-only">
        Illustration of a VeraKey payment: Face ID approves 2 USDG on a phone, the browser proves it in
        zero knowledge, and the dashboard shows the proof verified on Arbitrum with the public key
        appearing zero times on-chain.
      </p>
      <div className="showcase-glow" aria-hidden="true" />

      <div className="showcase-browser" aria-hidden="true" inert>
        <div className="browser-bar">
          <span className="browser-dots"><i /><i /><i /></span>
          <span className="browser-url"><Lock size={10} /> verakey.mdloglabs.org<span>/app/pay</span></span>
          <span className="browser-tag">Preview</span>
        </div>
        <div ref={viewport} className="browser-viewport">
          <div className="browser-canvas" style={viewportScale}>
            <div className="vk-app showcase-app">
              <AppTop network={NETWORK} prover={PROVER} session={SESSION} />
              <div className="vk-layout showcase-page">
                <AppNav location="/app/pay" />
                <main className="vk-main"><PayDesktop {...view} /></main>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="showcase-phone" aria-hidden="true" inert>
        <div ref={screen} className="phone-screen">
          <div className="phone-canvas" style={screenScale}>
            <div className="vk-app vk-compact phone-app">
              <div className="ios-status">
                <span className="ios-time">9:41</span>
                <span className="ios-island" />
                <span className="ios-icons"><Signal size={17} strokeWidth={2.6} /><Wifi size={17} strokeWidth={2.6} /><BatteryFull size={24} strokeWidth={1.8} /></span>
              </div>
              <div className="phone-scroll">
                <AppTop network={NETWORK} prover={PROVER} session={SESSION} />
                <div className="vk-layout">
                  <AppNav location="/app/pay" />
                  <main className="vk-main"><PayMobile {...view} /></main>
                </div>
              </div>
              {(phase === "sheet" || phase === "faceid") && <PasskeySheet scanning={phase === "faceid"} />}
              <div className="ios-safari">
                <span className="ios-url"><span className="ios-aa">AA</span><span><Lock size={11} /> verakey.mdloglabs.org</span><RotateCw size={13} /></span>
                <span className="ios-home" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {phase === "relaying" && (
        <span className="showcase-packet" aria-hidden="true"><LockKeyhole size={11} /> proof · {PROOF_BYTES.toLocaleString("en-US")} B · no key</span>
      )}
      <p className="showcase-caption" aria-hidden="true">The app's own /app/pay views, playing one payment · proof time measured in desktop Chrome</p>
    </div>
  );
}

/** The iOS passkey sheet, which the system shows over the page while the passkey signs. */
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
