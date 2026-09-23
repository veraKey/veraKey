import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Cpu,
  CreditCard,
  ExternalLink,
  Gamepad2,
  Fingerprint,
  KeyRound,
  Layers3,
  LockKeyhole,
  Menu,
  Network,
  Orbit,
  Route,
  ScanFace,
  ShieldCheck,
  Sparkles,
  Terminal,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { BrandMark } from "@/components/BrandMark";
import { HeroShowcase } from "@/components/HeroShowcase";

const pillars = [
  {
    id: "passkey",
    number: "01",
    eyebrow: "HARDWARE-BOUND",
    title: "Your face is the key.",
    copy: "WebAuthn signs directly from the Secure Enclave. No seed phrase, no browser extension, no custodial middle layer.",
    icon: Fingerprint,
    metric: "Origin-bound",
    metricCopy: "Phishing-resistant by design",
    color: "cyan",
  },
  {
    id: "privacy",
    number: "02",
    eyebrow: "PRIVATE BY DEFAULT",
    title: "Prove it. Don't reveal it.",
    copy: "Your browser proves, with a Noir circuit, that your passkey signed this exact action. The chain gets the proof and a per-app nullifier, never your public key or signature.",
    icon: ShieldCheck,
    metric: "UltraHonk",
    metricCopy: "Proven in-browser in ~3 s",
    color: "lime",
  },
  {
    id: "policy",
    number: "03",
    eyebrow: "POLICY-AWARE",
    title: "Authenticated is not authorized.",
    copy: "A valid proof only says an owner approved. The account's on-chain policy decides: per-payment and daily USDG caps, a recipient allowlist, and timelocks on every change.",
    icon: LockKeyhole,
    metric: "Timelocked",
    metricCopy: "Caps · allowlist · recovery",
    color: "violet",
  },
  {
    id: "settlement",
    number: "04",
    eyebrow: "ARBITRUM-NATIVE",
    title: "Settlement at the speed of intent.",
    copy: "A Rust smart account on Stylus parses WebAuthn data, checks the proof and pays in Paxos USDG on Arbitrum. Gasless: the relayer's fee is paid in USDG and signed into your approval.",
    icon: Orbit,
    metric: "USDG",
    metricCopy: "Stylus account · Arbitrum Sepolia",
    color: "orange",
  },
];

const architecture = [
  {
    label: "01",
    title: "Biometric device",
    subtitle: "WebAuthn / Secure Enclave",
    detail: "The device creates a P-256 signature after a local face, fingerprint, or PIN check. The private key never leaves the hardware.",
    icon: ScanFace,
  },
  {
    label: "02",
    title: "In-browser prover",
    subtitle: "Noir / UltraHonk / bb.js",
    detail: "Your browser proves the P-256 signature, the rpId and the user-verification flags without revealing the key. Only the proof and a per-app nullifier leave the device.",
    icon: Network,
  },
  {
    label: "03",
    title: "Stylus account",
    subtitle: "Rust / WASM / UltraHonk verifier",
    detail: "The Stylus account checks clientDataJSON (type, challenge, origin), calls the verifier with six public inputs, consumes its nonce and applies the USDG policy.",
    icon: Cpu,
  },
  {
    label: "04",
    title: "USDG settlement",
    subtitle: "Arbitrum Sepolia / gasless relay",
    detail: "Only a valid proof inside the policy moves USDG. A relayer submits the transaction and is paid its fee in USDG; anyone else may submit it too.",
    icon: Layers3,
  },
];

const signalRows = [
  { label: "Origin binding", value: "rpIdHash verified", icon: LockKeyhole },
  { label: "Replay defence", value: "nonce consumed", icon: Activity },
  { label: "Proof status", value: "UltraHonk valid", icon: BadgeCheck },
  { label: "Policy engine", value: "caps enforced", icon: BrainCircuit },
];

const useCases = [
  {
    id: "defi",
    label: "01",
    title: "Savings",
    subtitle: "A vault you rarely touch",
    copy: "A separate account for savings, owned by the same passkey, that no other app can connect to your spending account.",
    detail: "Tight daily caps and a recipient allowlist; raising them waits out a timelock that any owner can cancel.",
    icon: WalletCards,
    color: "cyan",
    tags: ["daily caps", "allowlist", "timelocks"],
  },
  {
    id: "gaming",
    label: "02",
    title: "Creator tips",
    subtitle: "Small payments, separate identity",
    copy: "Tip creators from an account that shares no key material with your savings or your checkout history.",
    detail: "One Face ID per tip; the per-payment cap keeps a compromised session small.",
    icon: Gamepad2,
    color: "violet",
    tags: ["per-app account", "small caps", "no seed phrase"],
  },
  {
    id: "payments",
    label: "03",
    title: "Payments",
    subtitle: "Biometric-native checkout",
    copy: "Turn a stablecoin payment into the interaction people already know: Pay → Face ID → Confirmed.",
    detail: "A consumer-ready path to Arbitrum payments where the network disappears and authorization remains intuitive.",
    icon: CreditCard,
    color: "lime",
    tags: ["stablecoins", "checkout", "account abstraction"],
  },
  {
    id: "rwa",
    label: "04",
    title: "Your app",
    subtitle: "@verakey/sdk",
    copy: "Add passkey accounts to any Arbitrum app with the SDK: register, derive the account, authorize, pay. Proving runs in your users' browsers.",
    detail: "Next milestone: an ERC-7579 validator so ZeroDev Kernel accounts can use VeraKey proofs.",
    icon: Building2,
    color: "orange",
    tags: ["typescript sdk", "gasless relay", "erc-7579 next"],
  },
];

const proofStages = [
  { label: "Capture", title: "Passkey assertion captured", detail: "The authenticator signs a challenge locally. The biometric signal never leaves the device.", code: "navigator.credentials.get()", icon: ScanFace },
  { label: "Derive", title: "Per-app nullifier derived", detail: "Your owner ID in this app mixes the public key with a PRF secret only the passkey can produce, so a leaked key alone cannot link your accounts.", code: "nullifier = Poseidon2(pk, prf, appId)", icon: LockKeyhole },
  { label: "Prove", title: "UltraHonk proof generated", detail: "bb.js proves the P-256 signature, rpId and UV flag in your browser. The key and signature are private inputs; they never leave the device.", code: "backend.generateProof(witness)", icon: Cpu },
  { label: "Verify", title: "Proof verified on Arbitrum", detail: "The Stylus account checks clientDataJSON, the proof, the nonce and the USDG policy before it pays.", code: "account.pay(to, amount, …, proof)", icon: ShieldCheck },
];

function SectionKicker({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <div className={`section-kicker ${light ? "section-kicker-light" : ""}`}>
      <span className="kicker-line" />
      <span>{children}</span>
    </div>
  );
}

export default function Home() {
  const [, navigate] = useLocation();
  const [activePillar, setActivePillar] = useState("passkey");
  const [activeArchitecture, setActiveArchitecture] = useState(0);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [demoStatus, setDemoStatus] = useState<"idle" | "signing" | "verified">("idle");
  const [activeUseCase, setActiveUseCase] = useState("defi");
  const [proofStage, setProofStage] = useState(-1);
  const [proofRunning, setProofRunning] = useState(false);

  const selectedPillar = useMemo(
    () => pillars.find((pillar) => pillar.id === activePillar) ?? pillars[0],
    [activePillar],
  );
  const SelectedPillarIcon = selectedPillar.icon;
  const selectedArchitecture = architecture[activeArchitecture];
  const ArchitectureIcon = selectedArchitecture.icon;
  const selectedUseCase = useCases.find((useCase) => useCase.id === activeUseCase) ?? useCases[0];
  const SelectedUseCaseIcon = selectedUseCase.icon;

  useEffect(() => {
    if (demoStatus !== "signing") return;
    const timeout = window.setTimeout(() => setDemoStatus("verified"), 1700);
    return () => window.clearTimeout(timeout);
  }, [demoStatus]);

  useEffect(() => {
    const revealObserver = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add("is-visible")),
      { threshold: 0.14 },
    );
    document.querySelectorAll("[data-reveal]").forEach((element) => revealObserver.observe(element));

    const heroVisual = document.querySelector<HTMLElement>(".hero-visual");
    if (!heroVisual || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return () => revealObserver.disconnect();
    }
    const handlePointerMove = (event: PointerEvent) => {
      const bounds = heroVisual.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      heroVisual.style.setProperty("--mx", x.toFixed(3));
      heroVisual.style.setProperty("--my", y.toFixed(3));
    };
    const resetPointer = () => {
      heroVisual.style.setProperty("--mx", "0");
      heroVisual.style.setProperty("--my", "0");
    };
    heroVisual.addEventListener("pointermove", handlePointerMove);
    heroVisual.addEventListener("pointerleave", resetPointer);
    return () => {
      revealObserver.disconnect();
      heroVisual.removeEventListener("pointermove", handlePointerMove);
      heroVisual.removeEventListener("pointerleave", resetPointer);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const updateScrollProgress = () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      root.style.setProperty("--scroll-progress", `${maxScroll > 0 ? (window.scrollY / maxScroll) * 100 : 0}%`);
    };
    updateScrollProgress();
    window.addEventListener("scroll", updateScrollProgress, { passive: true });

    const trail = Array.from(document.querySelectorAll<HTMLElement>(".cursor-trail-dot"));
    const handlePointerMove = (event: PointerEvent) => {
      trail.forEach((dot, index) => {
        dot.style.setProperty("--trail-x", `${event.clientX}px`);
        dot.style.setProperty("--trail-y", `${event.clientY}px`);
        dot.style.setProperty("--trail-delay", `${index * 42}ms`);
      });
      document.body.classList.add("has-pointer");
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: true });

    const magneticButtons = Array.from(document.querySelectorAll<HTMLElement>(".magnetic-button"));
    const cleanups = magneticButtons.map((button) => {
      const move = (event: PointerEvent) => {
        if (window.matchMedia("(pointer: coarse)").matches) return;
        const bounds = button.getBoundingClientRect();
        const x = (event.clientX - bounds.left - bounds.width / 2) * 0.18;
        const y = (event.clientY - bounds.top - bounds.height / 2) * 0.24;
        button.style.setProperty("--mag-x", `${x}px`);
        button.style.setProperty("--mag-y", `${y}px`);
      };
      const leave = () => {
        button.style.setProperty("--mag-x", "0px");
        button.style.setProperty("--mag-y", "0px");
      };
      button.addEventListener("pointermove", move);
      button.addEventListener("pointerleave", leave);
      return () => {
        button.removeEventListener("pointermove", move);
        button.removeEventListener("pointerleave", leave);
      };
    });
    return () => {
      window.removeEventListener("scroll", updateScrollProgress);
      window.removeEventListener("pointermove", handlePointerMove);
      document.body.classList.remove("has-pointer");
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  useEffect(() => {
    if (!proofRunning) return;
    const timer = window.setInterval(() => {
      setProofStage((current) => {
        if (current >= proofStages.length - 1) {
          window.clearInterval(timer);
          setProofRunning(false);
          return current;
        }
        return current + 1;
      });
    }, 950);
    return () => window.clearInterval(timer);
  }, [proofRunning]);

  const runDemo = () => {
    if (demoStatus === "signing") return;
    setDemoStatus("signing");
    window.setTimeout(() => {
      document.getElementById("demo-result")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  };

  const runProofSimulation = () => {
    setProofStage(0);
    setProofRunning(true);
    window.setTimeout(() => document.getElementById("proof-lab")?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  };

  const openApp = () => navigate("/app");
  const openDocs = () => navigate("/docs");

  const scrollTo = (id: string) => {
    setMobileMenu(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="site-shell">
      <div className="cursor-trail" aria-hidden="true"><span className="cursor-trail-dot trail-dot-one" /><span className="cursor-trail-dot trail-dot-two" /><span className="cursor-trail-dot trail-dot-three" /></div>
      <div className="proof-progress" aria-label="Proof journey progress">
        <div className="proof-progress-label">PROOF PATH</div>
        <div className="proof-progress-rail"><span className="proof-progress-fill" /><i style={{ top: "0%" }} /><i style={{ top: "33%" }} /><i style={{ top: "66%" }} /><i style={{ top: "100%" }} /></div>
        <div className="proof-progress-steps"><span>DEVICE</span><span>PROOF</span><span>STYLUS</span><span>ARBITRUM</span></div>
      </div>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="noise-overlay" />

      <div className="announcement-bar">
        <div className="announcement-inner">
          <span className="announcement-pulse" />
          <span>Live on Arbitrum Sepolia · Arbitrum Open House Singapore</span>
          <span className="announcement-divider" />
          <span className="announcement-muted">Hide-My-Email for wallets</span>
          <ArrowUpRight size={13} />
        </div>
      </div>

      <header className="site-nav">
        <div className="container nav-inner">
          <button className="brand-lockup" onClick={() => scrollTo("top")} aria-label="VeraKey home">
            <BrandMark />
            <span className="brand-wordmark">Vera<span>Key</span></span>
          </button>

          <nav className={`desktop-nav ${mobileMenu ? "mobile-open" : ""}`} aria-label="Primary navigation">
            <button onClick={() => scrollTo("why")}>Why now</button>
            <button onClick={() => scrollTo("stack")}>Proof stack</button>
            <button onClick={() => scrollTo("architecture")}>Architecture</button>
            <button onClick={openDocs}>Docs</button>
            <div className="mobile-nav-cta">
              <button className="button button-primary magnetic-button" onClick={openApp}>Open app <ArrowUpRight size={16} /></button>
            </div>
          </nav>

          <div className="nav-actions">
            <button className="nav-github" onClick={openDocs} aria-label="Developer docs">
              <Terminal size={17} />
            </button>
            <button className="button button-primary nav-cta magnetic-button" onClick={openApp}>Open app <ArrowUpRight size={16} /></button>
            <button className="menu-toggle" onClick={() => setMobileMenu((open) => !open)} aria-label="Toggle menu">
              {mobileMenu ? <X size={21} /> : <Menu size={21} />}
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="container hero-grid">
            <div className="hero-copy">
              <div className="eyebrow-row"><span className="eyebrow-dot" /> HIDE-MY-EMAIL FOR WALLETS</div>
              <h1>One passkey.<br /><em>Unlinkable accounts.</em></h1>
              <p className="hero-lede">VeraKey gives every app its own USDG smart account behind one passkey. Your browser proves in zero knowledge that the passkey approved each payment, so Arbitrum never sees your key and nothing on-chain ties your accounts together.</p>
              <div className="hero-actions">
                <button className="button button-primary button-large magnetic-button" onClick={openApp}>Open the app <ArrowRight size={17} /></button>
                <button className="text-button" onClick={() => scrollTo("architecture")}>Explore the stack <ChevronRight size={16} /></button>
              </div>
              <div className="hero-trust-row">
                <div className="avatar-stack" aria-hidden="true"><span>F</span><span>R</span><span>A</span></div>
                <span>One passkey. Multiple experiences.<br />For apps that put people first.</span>
              </div>
            </div>

            <HeroShowcase />
          </div>
          <div className="scroll-cue"><span>SCROLL TO COMPOSE</span><ArrowDownRight size={14} /></div>
        </section>

        <section className="network-strip" aria-label="Technology partners">
          <div className="container network-strip-inner">
            <span className="network-label">STACKED ON</span>
            <div className="network-item"><Orbit size={17} /> <span>ARBITRUM <b>STYLUS</b></span></div>
            <div className="network-item"><KeyRound size={17} /> <span>W3C <b>WEBAUTHN</b></span></div>
            <div className="network-item"><Terminal size={17} /> <span>RUST <b>WASM</b></span></div>
            <div className="network-item"><LockKeyhole size={17} /> <span>FIDO2 <b>READY</b></span></div>
          </div>
        </section>

        <section className="human-layer-section section-pad" data-reveal>
          <div className="container human-layer-layout">
            <div className="human-layer-copy"><SectionKicker>THE HUMAN LAYER</SectionKicker><h2>Blockchain<br /><em>without the wallet.</em></h2><p>VeraKey moves the complexity where it belongs: into the authentication infrastructure—not into the user's first interaction.</p><blockquote>“The user sees a passkey.<br />The chain sees a proof.”</blockquote></div>
            <div className="experience-compare">
              <div className="compare-column compare-old"><span className="compare-label">TRADITIONAL FLOW</span><div className="compare-step muted-step"><span>01</span><strong>User</strong></div><div className="compare-arrow">↓</div><div className="compare-step muted-step"><span>02</span><strong>Wallet</strong></div><div className="compare-arrow">↓</div><div className="compare-step muted-step"><span>03</span><strong>Seed phrase <small>· network · gas</small></strong></div><div className="compare-arrow">↓</div><div className="compare-step muted-step"><span>04</span><strong>Transaction</strong></div></div>
              <div className="compare-divider"><ArrowRight size={15} /></div>
              <div className="compare-column compare-new"><span className="compare-label">VERAKEY FLOW</span><div className="compare-step active-step"><span>01</span><strong>Face ID / passkey</strong></div><div className="compare-arrow">↓</div><div className="compare-step active-step"><span>02</span><strong>Zero-knowledge proof</strong></div><div className="compare-arrow">↓</div><div className="compare-step active-step"><span>03</span><strong>Arbitrum <small>· verified</small></strong></div><div className="compare-arrow">↓</div><div className="compare-step active-step final-step"><span>04</span><strong>Application</strong><CircleCheck size={16} /></div></div>
            </div>
          </div>
        </section>

        <section className="why-section section-pad" id="why" data-reveal>
          <div className="container">
              <div className="section-heading split-heading">
              <div><SectionKicker>THE FRICTION</SectionKicker><h2>Blockchain asks humans<br /><em>to adapt to infrastructure.</em></h2></div>
              <div className="heading-aside"><p>VeraKey reverses the relationship. The user sees a familiar authentication experience; the application receives authorization; the chain verifies a proof.</p><span className="aside-line" /></div>
            </div>
            <div className="friction-grid">
              <article className="friction-card friction-card-dark" data-reveal>
                <div className="card-index">01 / OLD DEFAULT</div>
                <div className="friction-icon warning-icon"><KeyRound size={22} /></div>
                <h3>Secret words<br />as a single point<br />of failure.</h3>
                <p>Connect wallet. Select network. Check gas. A 12–24 word phrase is not a user experience—it is infrastructure leaking into the moment.</p>
                <div className="card-foot"><span className="status-bad"><span /> FRAGILE BY DESIGN</span><ArrowUpRight size={15} /></div>
              </article>
              <article className="friction-card friction-card-light" data-reveal>
                <div className="card-index">02 / NEW PRIMITIVE</div>
                <div className="friction-icon fingerprint-icon"><Fingerprint size={22} /></div>
                <h3>One familiar gesture.<br /><em>Zero unnecessary exposure.</em></h3>
                <p>Face ID approves the action. Your key never reaches the chain, and every app sees a different account.</p>
                <div className="card-foot"><span className="status-good"><span /> HARDWARE-BOUND</span><ArrowUpRight size={15} /></div>
              </article>
              <div className="friction-note"><Sparkles size={16} /><span>THE HUMAN LAYER</span><p>Make onchain applications feel natural without making privacy an afterthought.</p></div>
            </div>
          </div>
        </section>

        <section className="stack-section section-pad" id="stack" data-reveal>
          <div className="container">
            <div className="section-heading stack-heading"><SectionKicker light>THE PROOF STACK</SectionKicker><h2>One interaction.<br /><em>Four layers of certainty.</em></h2><p>Every layer has one job: keep the experience human at the edge, the identity private in the middle, and the authorization verifiable at the core.</p></div>
            <div className="stack-layout">
              <div className="pillar-list">
                {pillars.map((pillar) => {
                  const Icon = pillar.icon;
                  const isActive = activePillar === pillar.id;
                  return <button key={pillar.id} className={`pillar-row ${isActive ? "is-active" : ""}`} onClick={() => setActivePillar(pillar.id)}><span className="pillar-number">{pillar.number}</span><span className="pillar-icon"><Icon size={18} /></span><span className="pillar-title">{pillar.title}</span><ArrowUpRight className="pillar-arrow" size={16} /></button>;
                })}
              </div>
              <div className={`pillar-feature feature-${selectedPillar.color}`}>
                <div className="feature-orb"><SelectedPillarIcon size={30} /></div>
                <div className="feature-eyebrow">{selectedPillar.eyebrow} <span>{selectedPillar.number}</span></div>
                <h3>{selectedPillar.title}</h3>
                <p>{selectedPillar.copy}</p>
                <div className="feature-metric"><span>{selectedPillar.metric}</span><small>{selectedPillar.metricCopy}</small></div>
                <div className="feature-circuit"><span /><span /><span /><span /><span /></div>
              </div>
            </div>
          </div>
        </section>

        <section className="architecture-section section-pad" id="architecture" data-reveal>
          <div className="container">
            <div className="section-heading split-heading"><div><SectionKicker>THE ARCHITECTURE</SectionKicker><h2>From a face scan<br /><em>to finality.</em></h2></div><div className="heading-aside"><p>Four layers. No black boxes. Click through the path an assertion takes from secure hardware to a settled state.</p><span className="aside-line" /></div></div>
            <div className="architecture-layout">
              <div className="architecture-steps">
                {architecture.map((step, index) => { const Icon = step.icon; const isActive = activeArchitecture === index; return <button key={step.label} className={`architecture-step ${isActive ? "is-active" : ""}`} onClick={() => setActiveArchitecture(index)}><span className="step-no">{step.label}</span><span className="step-icon"><Icon size={18} /></span><span><strong>{step.title}</strong><small>{step.subtitle}</small></span><ChevronRight size={16} className="step-chevron" /></button>; })}
              </div>
              <div className="architecture-detail" data-reveal>
                <div className="detail-topline"><span>EXECUTION TRACE / {selectedArchitecture.label}</span><span className="trace-status"><CircleCheck size={14} /> VERIFIED PATH</span></div>
                <div className="detail-graphic"><div className="detail-grid" /><div className="detail-scan"><span /></div><div className="detail-icon"><ArchitectureIcon size={32} /></div><span className="detail-coord">{selectedArchitecture.label} / 04</span><span className="detail-coord coord-right">DETERMINISTIC</span></div>
                <div className="detail-copy"><div><div className="detail-eyebrow">LAYER {selectedArchitecture.label}</div><h3>{selectedArchitecture.title}</h3></div><p>{selectedArchitecture.detail}</p></div>
                <div className="detail-tags"><span>trustless</span><span>auditable</span><span>composable</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="demo-section section-pad" id="demo" data-reveal>
          <div className="container">
            <div className="demo-shell">
              <div className="demo-intro"><SectionKicker light>THE INTERACTION</SectionKicker><h2>Let the device<br /><em>do the talking.</em></h2><p>Pay, play, or transact with the authentication experience you already understand. Face ID unlocks a proof; VeraKey turns it into policy-aware authorization.</p><div className="demo-note"><CircleDashed size={15} /><span>PREVIEW ONLY · THE REAL FLOW RUNS IN THE APP</span></div><button className="text-button light-button" style={{ marginTop: 18 }} onClick={openApp}>Run it for real <ArrowRight size={16} /></button></div>
              <div className="demo-console" id="demo-result">
                <div className="console-header"><span><span className="console-dot" /> VERAKEY / DEMO CONSOLE</span><span>LOCAL PREVIEW</span></div>
                <div className="console-body">
                  <div className="console-wallet"><div className="wallet-icon"><WalletCards size={23} /></div><div><small>PAY ACCOUNT</small><strong>Pay <span className="verified-badge"><BadgeCheck size={12} /> deployed</span></strong></div><span className="wallet-network"><Orbit size={13} /> ARBITRUM SEPOLIA</span></div>
                  <div className="console-amount"><span>TRANSACTION INTENT</span><strong>2.00 USDG <small>→</small> 0x7a…4b</strong><div className="intent-rule"><span /> Policy / within daily cap</div></div>
                  <div className="console-progress">
                    <div className={`progress-item ${demoStatus !== "idle" ? "done" : "current"}`}><span className="progress-icon">{demoStatus !== "idle" ? <Check size={14} /> : <Fingerprint size={14} />}</span><span><b>Biometric proof</b><small>{demoStatus === "idle" ? "Awaiting local gesture" : "P-256 signature captured"}</small></span></div>
                    <div className={`progress-connector ${demoStatus === "verified" ? "done" : ""}`} />
                    <div className={`progress-item ${demoStatus === "verified" ? "done" : demoStatus === "signing" ? "current" : "pending"}`}><span className="progress-icon">{demoStatus === "verified" ? <Check size={14} /> : <ShieldCheck size={14} />}</span><span><b>ZK proof + policy</b><small>{demoStatus === "verified" ? "UltraHonk proof verified" : demoStatus === "signing" ? "Generating proof…" : "Locked until signed"}</small></span></div>
                  </div>
                  <button className={`button demo-button magnetic-button ${demoStatus === "verified" ? "demo-button-success" : ""}`} onClick={demoStatus === "verified" ? () => setDemoStatus("idle") : runDemo}>{demoStatus === "idle" ? <><ScanFace size={17} /> Approve with biometrics</> : demoStatus === "signing" ? <><span className="button-loader" /> Verifying locally…</> : <><CircleCheck size={17} /> Transaction authorized · Reset</>}</button>
                  {demoStatus === "verified" && <div className="console-success"><CircleCheck size={15} /><span>Authorization complete. State mutation is ready for settlement.</span><ExternalLink size={14} /></div>}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="proof-lab-section section-pad" id="proof-lab" data-reveal>
          <div className="container">
            <div className="section-heading split-heading"><div><SectionKicker>PROOF LAB / EXPLAINER</SectionKicker><h2>Watch trust<br /><em>become verifiable.</em></h2></div><div className="heading-aside"><p>Step through what happens during one payment. Then run it for real in the app, where it is a real proof and a real Arbitrum transaction.</p><span className="aside-line" /></div></div>
            <div className="proof-lab-shell">
              <div className="proof-lab-steps">
                {proofStages.map((stage, index) => {
                  const Icon = stage.icon;
                  const isDone = proofStage > index;
                  const isActive = proofStage === index;
                  return <button key={stage.label} className={`proof-lab-step ${isActive ? "is-active" : ""} ${isDone ? "is-done" : ""}`} onClick={() => { setProofStage(index); setProofRunning(false); }}><span className="proof-step-index">{isDone ? <Check size={12} /> : `0${index + 1}`}</span><span className="proof-step-icon"><Icon size={17} /></span><span><strong>{stage.label}</strong><small>{stage.title}</small></span><span className="proof-step-state">{isDone ? "DONE" : isActive ? "RUNNING" : "WAITING"}</span></button>;
                })}
              </div>
              <div className={`proof-lab-output ${proofStage >= 0 ? "has-proof" : ""}`}>
                <div className="proof-output-top"><span><span className="console-dot" /> LOCAL PROVER / TRACE</span><span>DEMO ONLY</span></div>
                <div className="proof-output-body">
                  <div className="proof-output-orb"><div className="proof-orb-rings" /><div className="proof-orb-core">{proofStage >= 0 ? <Check size={23} /> : <CircleDashed size={23} />}<span>{proofStage >= 3 ? "VALID" : proofStage >= 0 ? "PROVING" : "IDLE"}</span></div></div>
                  <div className="proof-output-copy"><span className="proof-output-label">{proofStage >= 0 ? `STEP 0${proofStage + 1} / ${proofStages.length}` : "READY TO SIMULATE"}</span><h3>{proofStage >= 0 ? proofStages[proofStage].title : "A proof, not a profile."}</h3><p>{proofStage >= 0 ? proofStages[proofStage].detail : "The biometric unlocks a local assertion. VeraKey transforms it into a proof the application can verify—without receiving the biometric itself."}</p>{proofStage >= 0 && <code>{proofStages[proofStage].code}</code>}</div>
                </div>
                <div className="proof-output-footer"><span>PRIVATE WITNESS <b>{proofStage >= 1 ? "SEALED" : "LOCAL"}</b></span><span>PUBLIC SIGNALS <b>{proofStage >= 2 ? "READY" : "WAITING"}</b></span><span>ONCHAIN VERIFIER <b>{proofStage >= 3 ? "PASS" : "LOCKED"}</b></span></div>
              </div>
            </div>
            <div className="proof-lab-action"><button className="button button-primary button-large magnetic-button" onClick={proofStage >= proofStages.length - 1 ? () => { setProofStage(-1); setProofRunning(false); } : runProofSimulation}>{proofStage >= proofStages.length - 1 ? <>Reset simulation <ArrowRight size={17} /></> : proofRunning ? <><span className="button-loader" /> Generating proof…</> : <>Step through the lifecycle <ArrowUpRight size={17} /></>}</button><button className="text-button" onClick={openApp}>Run it for real <ArrowRight size={16} /></button><span><CircleDashed size={14} /> This explainer uses no key or device prompt.</span></div>
          </div>
        </section>

        <section className="usecases-section section-pad" id="usecases" data-reveal>
          <div className="container">
            <div className="section-heading split-heading"><div><SectionKicker>ONE PASSKEY. MANY WORLDS.</SectionKicker><h2>Built for the<br /><em>human edge.</em></h2></div><div className="heading-aside"><p>VeraKey is an authentication primitive, not another destination wallet. The policy changes by application; the familiar gesture stays.</p><span className="aside-line" /></div></div>
            <div className="usecase-layout">
              <div className="usecase-list">
                {useCases.map((useCase) => {
                  const Icon = useCase.icon;
                  return <button key={useCase.id} className={`usecase-card usecase-${useCase.color} ${activeUseCase === useCase.id ? "is-active" : ""}`} onClick={() => setActiveUseCase(useCase.id)}><span className="usecase-no">{useCase.label}</span><span className="usecase-icon"><Icon size={19} /></span><span className="usecase-name"><strong>{useCase.title}</strong><small>{useCase.subtitle}</small></span><ArrowUpRight className="usecase-arrow" size={16} /></button>;
                })}
              </div>
              <div className={`usecase-feature feature-${selectedUseCase.color}`}>
                <div className="usecase-feature-head"><div className="usecase-feature-icon"><SelectedUseCaseIcon size={27} /></div><span>APPLICATION PRIMITIVE / {selectedUseCase.label}</span></div>
                <h3>{selectedUseCase.title}<br /><em>{selectedUseCase.subtitle}.</em></h3>
                <p>{selectedUseCase.copy}</p>
                <div className="usecase-detail"><span>{selectedUseCase.detail}</span><div className="usecase-tags">{selectedUseCase.tags.map((tag) => <b key={tag}>{tag}</b>)}</div></div>
                <div className="usecase-visual"><span className="visual-pulse" /><span className="visual-pulse pulse-two" /><span className="visual-line line-one" /><span className="visual-line line-two" /><span className="visual-line line-three" /></div>
              </div>
            </div>
          </div>
        </section>

        <section className="metrics-section section-pad" data-reveal>
          <div className="container metrics-layout">
            <div><SectionKicker>THE COST OF PRIVACY</SectionKicker><h2>Privacy has a price.<br /><em>We publish it.</em></h2><p className="metrics-lede">Arbitrum verifies an UltraHonk proof instead of a bare P-256 signature. That costs more gas than the precompile, and buys an account that shares no key with your other apps. Measured on a nitro devnode running ArbOS 61; on Arbitrum One that is cents per payment.</p><button className="outline-button" onClick={openDocs}><ShieldCheck size={15} /> Read the threat model</button></div>
            <div className="metrics-chart">
              <div className="chart-header"><span>MEASURED GAS PER OPERATION</span><span>NITRO DEVNODE · ARBOS 61</span></div>
              <div className="bar-row"><div className="bar-label"><span>P256VERIFY precompile (no privacy)</span><strong>3,450</strong></div><div className="bar-track"><div className="bar-fill bar-new" style={{ width: "1%" }} /></div></div>
              <div className="bar-row"><div className="bar-label"><span>HonkVerifier.verify (the proof)</span><strong>3,781,398</strong></div><div className="bar-track"><div className="bar-fill bar-old" style={{ width: "91%" }} /></div></div>
              <div className="bar-row"><div className="bar-label"><span>VeraKey pay (proof + policy + 2 USDG transfers)</span><strong className="accent-number">4,171,302</strong></div><div className="bar-track"><div className="bar-fill bar-old" style={{ width: "100%" }} /></div></div>
              <div className="chart-foot"><span><Zap size={14} /> account creation: <b>80,812 gas</b> (EIP-1167 clone)</span><span>STYLUS · RUST</span></div>
            </div>
          </div>
        </section>

        <section className="closing-section section-pad" data-reveal>
          <div className="container closing-inner"><div className="closing-art"><div className="closing-orbit orbit-one" /><div className="closing-orbit orbit-two" /><div className="closing-orbit orbit-three" /><div className="closing-center"><BrandMark /><span>AUTHENTICATE<br /><em>PROVE.</em><br />USE.</span></div></div><div className="closing-copy"><SectionKicker light>THE NEW DEFAULT</SectionKicker><h2>Make the hard<br />things <em>invisible.</em></h2><p>Today, blockchain asks users to adapt to the infrastructure. VeraKey asks the infrastructure to adapt to the user—with privacy-preserving authentication that feels as natural as unlocking a phone.</p><div className="closing-actions"><button className="button button-primary button-large magnetic-button" onClick={openApp}>Open the app <ArrowUpRight size={17} /></button><button className="text-button light-button" onClick={openDocs}>Read the developer docs <ArrowRight size={16} /></button></div></div></div>
        </section>
      </main>

      <footer className="site-footer"><div className="container footer-inner"><div className="footer-brand"><button className="brand-lockup" onClick={() => scrollTo("top")}><BrandMark /><span className="brand-wordmark">Vera<span>Key</span></span></button><p>Passkey-native authorization<br />for the Arbitrum era.</p></div><div className="footer-links"><div><span>EXPLORE</span><button onClick={() => scrollTo("why")}>Why now</button><button onClick={() => scrollTo("architecture")}>Architecture</button></div><div><span>RESOURCES</span><button onClick={openApp}>Open the app</button><button onClick={openDocs}>Developer docs</button></div><div><span>STATUS</span><p className="status-online"><span /> Live on Arbitrum Sepolia</p><p>Arbitrum Open House<br />Singapore · 2026</p></div></div></div><div className="container footer-bottom"><span>© 2026 VERAKEY SYSTEMS</span><span>BUILT WITH WEBAUTHN · ZK · STYLUS</span><span>TESTNET PREVIEW · CONTRACTS UNAUDITED</span></div></footer>
    </div>
  );
}

export function ArrowDownRightIcon() {
  return <ArrowDownRight size={14} />;
}

export function RouteIcon() {
  return <Route size={14} />;
}
