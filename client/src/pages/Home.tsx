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
  EyeOff,
  FileCheck2,
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
  ReceiptText,
  Snowflake,
  Sparkles,
  Terminal,
  UserPlus,
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
    eyebrow: "PASSKEY-NATIVE",
    title: "The passkey you already use.",
    copy: "iCloud Keychain or Google Password Manager signs each action after Face ID, Touch ID or a PIN. No seed phrase, no browser extension, no custodial middle layer.",
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
    metricCopy: "Proven in-browser in 1.9 s",
    color: "lime",
  },
  {
    id: "policy",
    number: "03",
    eyebrow: "POLICY-AWARE",
    title: "Authenticated is not authorized.",
    copy: "A valid proof only says an owner approved. The account's on-chain policy decides: per-payment and daily USDG caps, a smaller cap for a first payment to a new recipient and an optional allowlist. Tightening is instant; anything that loosens the policy waits out a timelock.",
    icon: LockKeyhole,
    metric: "Timelocked",
    metricCopy: "Caps · freeze · recovery",
    color: "violet",
  },
  {
    id: "settlement",
    number: "04",
    eyebrow: "ARBITRUM-NATIVE",
    title: "Settled in USDG on Arbitrum.",
    copy: "A Rust smart account on Stylus parses the WebAuthn data, hands the proof to a Solidity UltraHonk verifier and pays in Paxos USDG. Gasless: the relayer's fee is paid in USDG and signed into your approval.",
    icon: Orbit,
    metric: "USDG",
    metricCopy: "Stylus account · Arbitrum Sepolia",
    color: "orange",
  },
];

const architecture = [
  {
    label: "01",
    title: "Your passkey",
    subtitle: "WebAuthn / PRF",
    detail: "Your passkey provider signs this exact action with a P-256 key after Face ID, Touch ID or a PIN, and returns a PRF secret when you unlock. The private key never leaves the provider, which keeps it end-to-end encrypted across your devices.",
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
    subtitle: "Rust / WASM · Solidity verifier",
    detail: "The Stylus account checks clientDataJSON (type, challenge, origin), passes the proof and six public inputs to the bb-generated Solidity HonkVerifier, consumes its nonce and applies the USDG policy.",
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
    id: "payments",
    label: "01",
    title: "Payments",
    subtitle: "Face ID checkout in USDG",
    copy: "Pay → Face ID → Confirmed. The proof is made on the device, the relayer pays the gas, and the account's caps decide what goes through.",
    detail: "Other apps on the same passkey get their own accounts, and none of them shares key material with this one.",
    icon: CreditCard,
    color: "lime",
    tags: ["usdg", "gasless", "per-app account"],
  },
  {
    id: "sdk",
    label: "02",
    title: "Your app",
    subtitle: "@verakey/sdk",
    copy: "Add passkey accounts to any Arbitrum app with the SDK: register, derive the account, authorize, pay. Proving runs in your users' browsers.",
    detail: "On a modular smart account? The VeraKey ERC-7579 validator verifies the same proofs. It is built for accounts such as Kernel and Nexus and tested with real proofs as a module.",
    icon: Building2,
    color: "orange",
    tags: ["typescript sdk", "gasless relay", "erc-7579 validator"],
  },
  {
    id: "disclosure",
    label: "03",
    title: "Compliance",
    subtitle: "Linkable by consent",
    copy: "When an auditor or an exchange needs to know that two of your accounts are yours, approve a disclosure for them. A second circuit proves that one passkey owns both, without revealing the key.",
    detail: "The disclosure names its audience and an expiry, anyone can check it against Arbitrum, and it cannot move funds.",
    icon: FileCheck2,
    color: "violet",
    tags: ["link circuit", "on-chain verifier", "expires"],
  },
];

const safetyNet = [
  {
    id: "freeze",
    title: "Freeze in one approval.",
    copy: "One Face ID stops every payment and cancels anything scheduled on the account. Unfreezing, like anything that loosens the policy, waits out a timelock that you or your guardian can cancel.",
    tag: "restrict · instant",
    icon: Snowflake,
  },
  {
    id: "new-recipient",
    title: "First payments stay small.",
    copy: "A recipient you have never paid receives at most 2 USDG in a first payment, even inside your caps. A look-alike address or a tampered page gets a small amount, not the balance.",
    tag: "new-recipient cap",
    icon: UserPlus,
  },
  {
    id: "payment-sheet",
    title: "The browser shows what you pay.",
    copy: "In Chrome on macOS, Windows and Android, the browser's own payment sheet shows the payee and the total, and the account checks both. Make the sheet a requirement, and a tampered page cannot pay without the browser showing you what you pay.",
    tag: "secure payment confirmation",
    icon: ReceiptText,
  },
  {
    id: "guardian",
    title: "A guardian nobody can see.",
    copy: "Your recovery guardian is stored as a salted hash, so nobody reading the chain can tell who it is until it acts. It can freeze and veto changes, but never block its own replacement.",
    tag: "guardian commitment",
    icon: EyeOff,
  },
];

const proofStages = [
  { label: "Capture", title: "Passkey signs the action", detail: "The WebAuthn challenge commits to this exact payment: chain, account, nonce, amount, recipient, fee and a deadline. Your passkey signs it on the device.", code: "navigator.credentials.get()", icon: ScanFace },
  { label: "Derive", title: "Per-app nullifier derived", detail: "Your owner ID in this app mixes the public key with a PRF secret only the passkey can produce, so a leaked key alone cannot link your accounts.", code: "nullifier = Poseidon2(pk, prf, appId)", icon: LockKeyhole },
  { label: "Prove", title: "UltraHonk proof generated", detail: "bb.js proves the P-256 signature, rpId and UV flag in your browser. The key and signature are private inputs; they never leave the device.", code: "backend.generateProof(witness)", icon: Cpu },
  { label: "Verify", title: "Proof verified on Arbitrum", detail: "The Stylus account checks clientDataJSON, has the Solidity verifier check the proof, then applies the nonce and the USDG policy before it pays.", code: "account.pay(to, amount, …, proof)", icon: ShieldCheck },
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
  const [activeUseCase, setActiveUseCase] = useState("payments");
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
            <button onClick={() => scrollTo("safety")}>Safety net</button>
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
              <p className="hero-lede">VeraKey gives every app its own USDG smart account behind one passkey. Your browser proves in zero knowledge that the passkey approved each payment, so Arbitrum never sees your key and no key material on-chain ties your accounts together.</p>
              <div className="hero-actions">
                <button className="button button-primary button-large magnetic-button" onClick={openApp}>Open the app <ArrowRight size={17} /></button>
                <button className="text-button" onClick={() => scrollTo("architecture")}>Explore the stack <ChevronRight size={16} /></button>
              </div>
              <div className="hero-trust-row">
                <ul className="hero-facts">
                  <li><Check size={13} /> Live on Arbitrum Sepolia</li>
                  <li><Check size={13} /> 1.9 s proof in your browser</li>
                  <li><Check size={13} /> 61 end-to-end tests</li>
                </ul>
              </div>
            </div>

            <HeroShowcase />
          </div>
          <div className="scroll-cue"><span>SCROLL TO COMPOSE</span><ArrowDownRight size={14} /></div>
        </section>

        <section className="network-strip" aria-label="Built with">
          <div className="container network-strip-inner">
            <span className="network-label">BUILT WITH</span>
            <div className="network-item"><Orbit size={17} /> <span>ARBITRUM <b>STYLUS</b></span></div>
            <div className="network-item"><Cpu size={17} /> <span>NOIR <b>ULTRAHONK</b></span></div>
            <div className="network-item"><KeyRound size={17} /> <span>W3C <b>WEBAUTHN</b></span></div>
            <div className="network-item"><CreditCard size={17} /> <span>PAXOS <b>USDG</b></span></div>
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
              <div><SectionKicker>THE PROBLEM</SectionKicker><h2>Passkeys fixed<br />the seed phrase.<br /><em>Not the tracking.</em></h2></div>
              <div className="heading-aside"><p>Cross-app wallets turn one passkey into one global ID: one address in every app, or several accounts tied together on-chain by the same key. Anyone reading the chain can join that activity, and the merchant you pay can see your savings.</p><span className="aside-line" /></div>
            </div>
            <div className="friction-grid">
              <article className="friction-card friction-card-dark" data-reveal>
                <div className="card-index">01 / A PASSKEY WALLET TODAY</div>
                <div className="friction-icon warning-icon"><KeyRound size={22} /></div>
                <h3>One key,<br />one address,<br />every app.</h3>
                <p>Checkout, savings and tips read as one public history, and the passkey's public key sits on-chain: all eight passkey smart accounts we inspected store it or emit it in an event. One passkey per app avoids that, at the cost of an enrollment and a credential picker in every app.</p>
                <div className="card-foot"><span className="status-bad"><span /> LINKABLE BY DESIGN</span><ArrowUpRight size={15} /></div>
              </article>
              <article className="friction-card friction-card-light" data-reveal>
                <div className="card-index">02 / VERAKEY</div>
                <div className="friction-icon fingerprint-icon"><Fingerprint size={22} /></div>
                <h3>One passkey.<br /><em>No key on-chain.</em></h3>
                <p>Your browser proves in zero knowledge that your passkey approved the payment. Each app's account is owned by a per-app nullifier, made from the passkey and a PRF secret only it can produce. Amounts and recipients stay public, and USDG's issuer can still freeze any account.</p>
                <div className="card-foot"><span className="status-good"><span /> UNLINKABLE, NOT ANONYMOUS</span><ArrowUpRight size={15} /></div>
              </article>
              <div className="friction-note is-facts"><Sparkles size={16} /><span>WHY NOW</span><ul>
                <li><b>iOS 18.4</b> passkey PRF works the same on every Apple device</li>
                <li><b>Kohaku</b> Ethereum's privacy wallet roadmap defaults to a new address per app</li>
                <li><b>ArbOS 60</b> Stylus runs 46 KB Rust accounts</li>
              </ul></div>
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
            <div className="section-heading split-heading"><div><SectionKicker>THE ARCHITECTURE</SectionKicker><h2>From Face ID<br /><em>to finality.</em></h2></div><div className="heading-aside"><p>Four layers. No black boxes. Click through the path an approval takes from your passkey to a settled payment.</p><span className="aside-line" /></div></div>
            <div className="architecture-layout">
              <div className="architecture-steps">
                {architecture.map((step, index) => { const Icon = step.icon; const isActive = activeArchitecture === index; return <button key={step.label} className={`architecture-step ${isActive ? "is-active" : ""}`} onClick={() => setActiveArchitecture(index)}><span className="step-no">{step.label}</span><span className="step-icon"><Icon size={18} /></span><span><strong>{step.title}</strong><small>{step.subtitle}</small></span><ChevronRight size={16} className="step-chevron" /></button>; })}
              </div>
              <div className="architecture-detail" data-reveal>
                <div className="detail-topline"><span>EXECUTION TRACE / {selectedArchitecture.label}</span><span className="trace-status"><CircleCheck size={14} /> VERIFIED PATH</span></div>
                <div className="detail-graphic"><div className="detail-grid" /><div className="detail-scan"><span /></div><div className="detail-icon"><ArchitectureIcon size={32} /></div><span className="detail-coord">{selectedArchitecture.label} / 04</span><span className="detail-coord coord-right">DETERMINISTIC</span></div>
                <div className="detail-copy"><div><div className="detail-eyebrow">LAYER {selectedArchitecture.label}</div><h3>{selectedArchitecture.title}</h3></div><p>{selectedArchitecture.detail}</p></div>
                <div className="detail-tags"><span>open source</span><span>verifiable on-chain</span><span>testnet</span></div>
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
                  <div className="proof-output-copy"><span className="proof-output-label">{proofStage >= 0 ? `STEP 0${proofStage + 1} / ${proofStages.length}` : "READY TO SIMULATE"}</span><h3>{proofStage >= 0 ? proofStages[proofStage].title : "A proof, not a profile."}</h3><p>{proofStage >= 0 ? proofStages[proofStage].detail : "Your passkey signs on the device. VeraKey turns that signature into a proof the chain can verify, without receiving your public key or the signature."}</p>{proofStage >= 0 && <code>{proofStages[proofStage].code}</code>}</div>
                </div>
                <div className="proof-output-footer"><span>PRIVATE WITNESS <b>{proofStage >= 1 ? "SEALED" : "LOCAL"}</b></span><span>PUBLIC SIGNALS <b>{proofStage >= 2 ? "READY" : "WAITING"}</b></span><span>ONCHAIN VERIFIER <b>{proofStage >= 3 ? "PASS" : "LOCKED"}</b></span></div>
              </div>
            </div>
            <div className="proof-lab-action"><button className="button button-primary button-large magnetic-button" onClick={proofStage >= proofStages.length - 1 ? () => { setProofStage(-1); setProofRunning(false); } : runProofSimulation}>{proofStage >= proofStages.length - 1 ? <>Reset simulation <ArrowRight size={17} /></> : proofRunning ? <><span className="button-loader" /> Generating proof…</> : <>Step through the lifecycle <ArrowUpRight size={17} /></>}</button><button className="text-button" onClick={openApp}>Run it for real <ArrowRight size={16} /></button><span><CircleDashed size={14} /> This explainer uses no key or device prompt.</span></div>
          </div>
        </section>

        <section className="usecases-section section-pad" id="usecases" data-reveal>
          <div className="container">
            <div className="section-heading split-heading"><div><SectionKicker>ONE PASSKEY. EVERY APP.</SectionKicker><h2>Built for the<br /><em>human edge.</em></h2></div><div className="heading-aside"><p>VeraKey is the account layer under a passkey wallet, not another destination wallet. Each app gets its own account and policy; the gesture stays the same.</p><span className="aside-line" /></div></div>
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

        <section className="safety-section section-pad" id="safety" data-reveal>
          <div className="container">
            <div className="section-heading split-heading"><div><SectionKicker light>THE SAFETY NET</SectionKicker><h2>When things go wrong,<br /><em>the account holds.</em></h2></div><div className="heading-aside"><p>A passkey can be tricked into approving, a page can be tampered with, a phone can be lost. Each protection here is enforced by the account on Arbitrum, not by the app.</p><span className="aside-line" /></div></div>
            <div className="safety-grid">
              {safetyNet.map((item, index) => {
                const Icon = item.icon;
                return <article key={item.id} className="safety-card" data-reveal><div className="safety-card-top"><span className="safety-icon"><Icon size={19} /></span><span className="safety-index">0{index + 1} / 04</span></div><h3>{item.title}</h3><p>{item.copy}</p><span className="safety-tag">{item.tag}</span></article>;
              })}
            </div>
          </div>
        </section>

        <section className="metrics-section section-pad" data-reveal>
          <div className="container metrics-layout">
            <div><SectionKicker>THE COST OF PRIVACY</SectionKicker><h2>Privacy has a price.<br /><em>We publish it.</em></h2><p className="metrics-lede">Arbitrum verifies an UltraHonk proof instead of a bare P-256 signature. That costs more gas than the precompile, and buys an account that shares no key with your other apps. bb 5's optimized verifier, packed storage and cached Stylus programs cut the same payment from 4.17M to 1.02M gas. Gas is measured on a nitro devnode at ArbOS 61; dollars use Arbitrum One's gas price and the ETH price on 24 Sep 2026.</p><button className="outline-button" onClick={openDocs}><ShieldCheck size={15} /> Read the threat model</button></div>
            <div className="metrics-chart">
              <div className="chart-header"><span>MEASURED GAS PER OPERATION</span><span>NITRO DEVNODE · ARBOS 61</span></div>
              <div className="bar-row"><div className="bar-label"><span>P256VERIFY precompile (no privacy)</span><strong>3,450</strong></div><div className="bar-track"><div className="bar-fill bar-new" style={{ width: "1%" }} /></div></div>
              <div className="bar-row"><div className="bar-label"><span>HonkVerifier.verify (the proof)</span><strong>712,554</strong></div><div className="bar-track"><div className="bar-fill bar-old" style={{ width: "17%" }} /></div></div>
              <div className="bar-row"><div className="bar-label"><span>VeraKey payment from the app (proof, policy, 2 USDG transfers)</span><strong className="accent-number">1,021,759</strong></div><div className="bar-track"><div className="bar-fill bar-old" style={{ width: "24%" }} /></div></div>
              <div className="bar-row"><div className="bar-label"><span>The same payment with bb's default verifier (before)</span><strong className="muted-number">4,171,302</strong></div><div className="bar-track"><div className="bar-fill bar-muted" style={{ width: "100%" }} /></div></div>
              <div className="chart-cost">
                <div><span>PAY ON ARBITRUM ONE</span><strong>≈ $0.05</strong><small>0.02 gwei · ETH at $2,668</small></div>
                <div><span>BEFORE THE OPTIMIZED VERIFIER</span><strong>≈ $0.22</strong><small>the same payment, 4.17M gas</small></div>
                <div><span>PROOF CALLDATA (L1)</span><strong>≈ $0.002</strong><small>about 9 KB per payment</small></div>
              </div>
              <div className="chart-foot"><span><Zap size={14} /> account creation: <b>≈383k gas</b> (clone + storage init)</span><span>STYLUS · RUST</span></div>
            </div>
          </div>
        </section>

        <section className="closing-section section-pad" data-reveal>
          <div className="container closing-inner"><div className="closing-art"><div className="closing-orbit orbit-one" /><div className="closing-orbit orbit-two" /><div className="closing-orbit orbit-three" /><div className="closing-center"><BrandMark /><span>AUTHENTICATE<br /><em>PROVE.</em><br />USE.</span></div></div><div className="closing-copy"><SectionKicker light>THE NEW DEFAULT</SectionKicker><h2>Make the hard<br />things <em>invisible.</em></h2><p>Today, blockchain asks users to adapt to the infrastructure. VeraKey asks the infrastructure to adapt to the user—with privacy-preserving authentication that feels as natural as unlocking a phone.</p><div className="closing-actions"><button className="button button-primary button-large magnetic-button" onClick={openApp}>Open the app <ArrowUpRight size={17} /></button><button className="text-button light-button" onClick={openDocs}>Read the developer docs <ArrowRight size={16} /></button></div></div></div>
        </section>
      </main>

      <footer className="site-footer"><div className="container footer-inner"><div className="footer-brand"><button className="brand-lockup" onClick={() => scrollTo("top")}><BrandMark /><span className="brand-wordmark">Vera<span>Key</span></span></button><p>Passkey-native authorization<br />for the Arbitrum era.</p></div><div className="footer-links"><div><span>EXPLORE</span><button onClick={() => scrollTo("why")}>Why now</button><button onClick={() => scrollTo("architecture")}>Architecture</button><button onClick={() => scrollTo("safety")}>Safety net</button></div><div><span>RESOURCES</span><button onClick={openApp}>Open the app</button><button onClick={openDocs}>Developer docs</button></div><div><span>STATUS</span><p className="status-online"><span /> Live on Arbitrum Sepolia</p><p>Arbitrum Open House<br />Singapore · 2026</p></div></div></div><div className="container footer-bottom"><span>© 2026 VERAKEY SYSTEMS</span><span>BUILT WITH WEBAUTHN · ZK · STYLUS</span><span>TESTNET PREVIEW · CONTRACTS UNAUDITED</span></div></footer>
    </div>
  );
}

export function ArrowDownRightIcon() {
  return <ArrowDownRight size={14} />;
}

export function RouteIcon() {
  return <Route size={14} />;
}
