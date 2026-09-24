import type { ComponentType } from "react";
import { slugify } from "./slug";

export const GROUPS = ["Get started", "Use VeraKey", "Build", "Architecture", "Security", "Reference"] as const;
export type DocGroup = (typeof GROUPS)[number];

/** When the docs were last checked against the code and the live deployment. */
export const DOCS_UPDATED = "2026-09-24";

export interface DocPage {
  path: string;
  title: string;
  group: DocGroup;
  /** One or two sentences: the page's lead, its search subtitle and its meta description. */
  description: string;
  /** Extra search terms. */
  keywords: string[];
  /** The page's h2 headings, in order. Search links to them; scripts/check-docs.mjs checks they exist. */
  sections: string[];
  /** The page's h3 headings, in order. Search links to them too. */
  subsections?: string[];
  /** Search terms that live under one heading, such as error or function names, keyed by that h2 or h3. */
  headingKeywords?: Record<string, string[]>;
  /** A developer page: shown with a notice of what works today and what waits for developer access. */
  preview?: boolean;
  load: () => Promise<{ default: ComponentType }>;
}

/** Every docs page in reading order: the sidebar, previous/next and search all follow it. */
export const PAGES: DocPage[] = [
  {
    path: "/docs",
    title: "Introduction",
    group: "Get started",
    description: "One passkey, unlinkable on-chain identities: VeraKey gives you your own account and ID in every app built on it, and proves each approval in zero knowledge, so nothing on-chain links them.",
    keywords: ["overview", "what is verakey", "passkey", "identity", "sign in", "privacy", "arbitrum", "usdg"],
    sections: ["What VeraKey is", "Who it is for", "What you can do", "Project status", "Where to go next"],
    load: () => import("./pages/Introduction"),
  },
  {
    path: "/docs/problem",
    title: "The problem",
    group: "Get started",
    description: "Passkeys removed the seed phrase, but today's passkey wallets still let anyone reading the chain connect your activity across apps.",
    keywords: ["linkability", "tracking", "cross-app", "public key", "privacy"],
    sections: ["One passkey, one global identity", "The public key is on-chain", "Why one passkey per app is not enough", "What VeraKey changes", "Unlinkable, not anonymous"],
    load: () => import("./pages/Problem"),
  },
  {
    path: "/docs/how-it-works",
    title: "How VeraKey works",
    group: "Get started",
    description: "Follow one payment from Face ID to a settled USDG transfer: the action hash, the passkey signature, the in-browser proof, the relayer and the account's checks.",
    keywords: ["flow", "payment", "proof", "relayer", "walkthrough", "lifecycle"],
    sections: ["The journey of one payment", "Step by step", "What the chain sees", "What never leaves your device"],
    subsections: ["1. The app builds the action hash", "2. Your passkey signs it", "3. Your browser proves the signature", "4. The relayer submits", "5. The account checks and pays"],
    load: () => import("./pages/HowItWorks"),
  },
  {
    path: "/docs/concepts",
    title: "Key concepts",
    group: "Get started",
    description: "The ideas behind VeraKey in plain language: passkeys and PRF, nullifiers, per-app accounts, proofs, the relayer, policy and timelocks, guardians and disclosures.",
    keywords: ["concepts", "nullifier", "prf", "timelock", "relayer", "guardian", "disclosure", "explained"],
    sections: ["Passkeys and the PRF extension", "Nullifiers", "Per-app accounts", "Zero-knowledge proofs", "The relayer and fees", "Policy and timelocks", "Guardians and recovery", "Disclosures"],
    load: () => import("./pages/Concepts"),
  },
  {
    path: "/docs/guides/create-account",
    title: "Create your account",
    group: "Use VeraKey",
    description: "Create a VeraKey passkey, unlock it on your devices, and see the separate account each app gets.",
    keywords: ["register", "sign up", "passkey", "icloud keychain", "google password manager", "unlock", "prf"],
    sections: ["What you need", "Create your passkey", "Unlock on another device", "One account per app", "When an account is deployed"],
    subsections: ["Open the app", "Create passkey", "See your accounts"],
    load: () => import("./pages/guides/CreateAccount"),
  },
  {
    path: "/docs/guides/fund",
    title: "Fund and receive",
    group: "Use VeraKey",
    description: "Get demo USDG on Arbitrum Sepolia, receive payments with the Receive panel, and fund accounts without linking them.",
    keywords: ["faucet", "demo usdg", "receive", "qr code", "eip-681", "top up", "funding"],
    sections: ["Demo USDG", "Receive a payment", "Fund without linking your accounts"],
    load: () => import("./pages/guides/Fund"),
  },
  {
    path: "/docs/guides/pay",
    title: "Pay",
    group: "Use VeraKey",
    description: "Pay in USDG with one passkey approval, see what happens behind it, and understand why an account may refuse a payment.",
    keywords: ["payment", "checkout", "fee", "receipt", "refused", "authenticated not authorized", "send"],
    sections: ["Make a payment", "What happens when you approve", "Fees", "Confirm in the payment sheet", "Your receipt", "When a payment is refused"],
    subsections: ["Open Pay", "Enter the amount", "Approve with passkey"],
    load: () => import("./pages/guides/Pay"),
  },
  {
    path: "/docs/guides/protect",
    title: "Protect your account",
    group: "Use VeraKey",
    description: "Set caps, cap first payments to new recipients, freeze in one approval, and watch every scheduled change from any device.",
    keywords: ["freeze", "caps", "limits", "allowlist", "timelock", "new recipient", "emergency", "scheduled changes"],
    sections: ["Your policy at a glance", "Caps", "The new-recipient cap", "The allowlist", "Freeze", "Scheduled changes", "Require the payment sheet"],
    load: () => import("./pages/guides/Protect"),
  },
  {
    path: "/docs/guides/recovery",
    title: "Recovery and guardians",
    group: "Use VeraKey",
    description: "Add a backup passkey, name a private guardian, and recover an account if you lose your passkey.",
    keywords: ["recovery", "guardian", "backup passkey", "lost device", "guardian card", "social recovery"],
    sections: ["Add a backup passkey", "Name a guardian", "The guardian card", "Recover an account", "What a guardian can and cannot do"],
    load: () => import("./pages/guides/Recovery"),
  },
  {
    path: "/docs/guides/disclosures",
    title: "Prove two accounts are yours",
    group: "Use VeraKey",
    description: "Show an auditor or an exchange that two of your accounts belong to one passkey, without revealing the key, only to them and only for a while.",
    keywords: ["disclosure", "linkable by consent", "compliance", "auditor", "exchange", "verify", "proof of ownership"],
    sections: ["When to use a disclosure", "Make a disclosure", "Share it", "Verify a disclosure", "What a disclosure reveals"],
    subsections: ["Open Disclose", "Name the audience", "Add their nonce, if they gave you one", "Choose how long it is valid", "Approve disclosure with passkey"],
    load: () => import("./pages/guides/Disclosures"),
  },
  {
    path: "/docs/guides/faq",
    title: "FAQ and troubleshooting",
    group: "Use VeraKey",
    description: "Answers to common questions and fixes for the problems people run into most often.",
    keywords: ["faq", "help", "troubleshooting", "support", "problems", "questions"],
    sections: ["My passkey provider is not supported", "I lost my phone", "The faucet is out of USDG", "Authenticated, not authorized", "The payment sheet does not appear", "Is this real money?", "Where can I see my transactions?"],
    load: () => import("./pages/guides/Faq"),
  },
  {
    path: "/docs/build/quickstart",
    title: "Quickstart",
    group: "Build",
    preview: true,
    description: "Add passkey accounts with private, gasless USDG payments to a web app in six steps.",
    keywords: ["getting started", "install", "npm", "sdk", "tutorial", "integration", "first payment"],
    sections: ["Before you begin", "1. Get the SDK", "2. Configure the client", "3. Register a passkey", "4. Fund the account", "5. Make a payment", "6. Handle the result", "Next steps"],
    load: () => import("./pages/developers/Quickstart"),
  },
  {
    path: "/docs/build/sign-in",
    title: "Sign in with VeraKey",
    group: "Build",
    preview: true,
    description: "Let players sign in to your game or app with their VeraKey passkey, get a player ID for your site alone, and take USDG payments through the VeraKey popup.",
    keywords: ["sign in", "login", "auth", "popup", "game", "dapp", "player id", "connect", "web3 game", "npm"],
    sections: ["How sign-in works", "Add the button", "Verify on your server", "Take a payment", "Security checklist", "Errors and limits"],
    headingKeywords: {
      "Add the button": ["VeraKeyConnect", "signIn"],
      "Verify on your server": ["verifySignIn"],
      "Take a payment": ["pay", "verifyPayment"],
      "Errors and limits": ["blocked", "unavailable", "closed", "busy", "cancelled"],
    },
    load: () => import("./pages/developers/SignIn"),
  },
  {
    path: "/docs/build/sdk",
    title: "SDK guide",
    group: "Build",
    preview: true,
    description: "How the VeraKey SDK is organised: modules, configuration, sessions, accounts, the proof state machine, errors and proving performance.",
    keywords: ["sdk", "client", "session", "proofstate", "verakeyerror", "prover", "modules", "configuration"],
    sections: ["Modules", "Configuration", "Sessions", "Accounts", "The proof state machine", "Errors", "Proving performance"],
    load: () => import("./pages/developers/SdkGuide"),
  },
  {
    path: "/docs/build/policy",
    title: "Payments and policy",
    group: "Build",
    preview: true,
    description: "Pay, tighten an account's policy at once, schedule loosening changes, and read the policy with the SDK.",
    keywords: ["pay", "restrict", "schedulechange", "applychange", "cancelchange", "changepayload", "freeze", "pendingchanges"],
    sections: ["Paying", "Tightening at once", "Scheduling a change", "Applying and cancelling", "Change payloads", "Reading the policy"],
    load: () => import("./pages/developers/PolicyApi"),
  },
  {
    path: "/docs/build/payment-sheet",
    title: "Payment sheet",
    group: "Build",
    preview: true,
    description: "Use the browser's Secure Payment Confirmation sheet so the browser, not your page, shows the payee and the total of every payment.",
    keywords: ["spc", "secure payment confirmation", "payment sheet", "paymentrequest", "chrome", "payee", "total"],
    sections: ["Browser support", "Enroll a passkey", "Pay through the sheet", "Require the sheet", "What the account checks"],
    load: () => import("./pages/developers/PaymentSheet"),
  },
  {
    path: "/docs/build/disclosures",
    title: "Disclosures",
    group: "Build",
    preview: true,
    description: "Create and verify consent-to-link disclosures with the SDK: the statement, the package format and every check.",
    keywords: ["createdisclosure", "verifydisclosure", "linkstatement", "link circuit", "linkhonkverifier", "audience", "nonce"],
    sections: ["Create a disclosure", "The package format", "Verify a disclosure", "The checks", "On-chain or local verification"],
    load: () => import("./pages/developers/DisclosuresApi"),
  },
  {
    path: "/docs/build/erc-7579",
    title: "ERC-7579 validator",
    group: "Build",
    preview: true,
    description: "Bring VeraKey proofs to modular smart accounts with the VeraKeyValidator module: installation, user operation and ERC-1271 signatures, and gas.",
    keywords: ["erc-7579", "validator", "module", "kernel", "nexus", "erc-4337", "user operation", "erc-1271"],
    sections: ["What the module does", "Install it", "Sign a user operation", "ERC-1271 signatures", "Gas", "Limits"],
    load: () => import("./pages/developers/Validator"),
  },
  {
    path: "/docs/build/relayer-api",
    title: "Relayer API",
    group: "Build",
    preview: true,
    description: "The HTTP API of the VeraKey relayer: configuration, account creation, gasless relaying, the demo faucet and the RPC proxy.",
    keywords: ["relayer", "api", "http", "endpoints", "rest", "rate limits", "gasless", "faucet", "rpc"],
    sections: ["Overview", "GET /api/config", "GET /api/health", "POST /api/accounts", "POST /api/relay", "POST /api/faucet", "POST /api/rpc", "Errors", "Rate limits"],
    load: () => import("./pages/developers/RelayerApi"),
  },
  {
    path: "/docs/architecture",
    title: "System overview",
    group: "Architecture",
    description: "The components of VeraKey, how a payment flows between them, and where the trust boundaries are.",
    keywords: ["architecture", "components", "diagram", "data flow", "trust boundaries", "overview"],
    sections: ["Components", "A payment end to end", "Trust boundaries"],
    load: () => import("./pages/architecture/Overview"),
  },
  {
    path: "/docs/architecture/circuits",
    title: "Circuits",
    group: "Architecture",
    description: "The two Noir circuits behind VeraKey: what they prove, their public inputs, and how their verifiers are generated.",
    keywords: ["noir", "ultrahonk", "circuit", "public inputs", "p-256", "ecdsa", "poseidon2", "barretenberg", "nullifier"],
    sections: ["The authorization circuit", "Public inputs", "The nullifier", "The link circuit", "Toolchain and verifiers"],
    load: () => import("./pages/architecture/Circuits"),
  },
  {
    path: "/docs/architecture/contracts",
    title: "Smart contracts",
    group: "Architecture",
    description: "How the Stylus account and factory and the Solidity verifiers work: authorization, policy checks, storage layout and address derivation.",
    keywords: ["stylus", "rust", "account", "factory", "create2", "storage layout", "eip-1167", "solidity", "verifier"],
    sections: ["The account", "Authorization", "Policy checks", "Storage layout", "The factory", "Verifiers and the validator"],
    load: () => import("./pages/architecture/Contracts"),
  },
  {
    path: "/docs/architecture/gas",
    title: "Gas and performance",
    group: "Architecture",
    description: "What VeraKey costs on Arbitrum, where a payment spends its gas, and how fast the browser proves.",
    keywords: ["gas", "cost", "performance", "proving time", "benchmark", "fees", "arbitrum one"],
    sections: ["Measured costs", "Where a payment spends its gas", "Before and after", "Proving time", "What is left"],
    load: () => import("./pages/architecture/Gas"),
  },
  {
    path: "/docs/security",
    title: "Security model",
    group: "Security",
    description: "What VeraKey guarantees, what it assumes, and what it does not hide.",
    keywords: ["security", "threat model", "invariants", "trust assumptions", "privacy", "guarantees"],
    sections: ["What VeraKey protects", "Invariants", "Trust assumptions", "What still leaks", "Threat model"],
    subsections: ["Sign in with VeraKey", "The VeraKey page code", "The relayer", "The USDG issuer", "The proof system", "Browsers"],
    load: () => import("./pages/security/SecurityModel"),
  },
  {
    path: "/docs/security/review",
    title: "Review and accepted risks",
    group: "Security",
    description: "The audit status, the internal review and its fixes, the risks VeraKey accepts, and how to report a vulnerability.",
    keywords: ["audit", "review", "vulnerabilities", "risks", "dependencies", "report", "disclosure policy"],
    sections: ["Audit status", "Internal review", "Accepted risks", "Dependencies", "Report a vulnerability"],
    load: () => import("./pages/security/Review"),
  },
  {
    path: "/docs/reference/sdk",
    title: "SDK reference",
    group: "Reference",
    preview: true,
    description: "Every public method and type of the VeraKey SDK, with its signature.",
    keywords: ["api reference", "veraKeyclient", "methods", "types", "signatures"],
    sections: ["VeraKeyClient", "Types", "Action helpers", "WebAuthn helpers", "Disclosure helpers", "Validator helpers", "Sign-in helpers"],
    subsections: ["VeraKeyConfig", "Passkeys and sessions", "Accounts", "Actions", "Payment sheet, guardians and disclosures", "Properties and lower-level classes"],
    headingKeywords: {
      "VeraKeyConfig": ["rpId", "relayerUrl", "relayerFee", "appIds", "loadProver", "paymentInstrument"],
      "Passkeys and sessions": ["browserSupportsPrf", "register", "unlock", "authenticate", "lock", "shortCredentialId", "credentialIdOf"],
      "Accounts": ["nullifier", "predictAddress", "ensureAccount", "requestDemoFunds", "pendingChanges", "scheduledPayload", "isPending"],
      "Actions": ["pay", "scheduleChange", "restrict", "freeze", "cancelChange", "applyChange", "cancelRecovery", "executeRecovery", "authorize"],
      "Payment sheet, guardians and disclosures": ["canConfirmPayments", "guardianSalt", "guardianCard", "createDisclosure"],
      "Properties and lower-level classes": ["VeraKeyProver", "RelayerClient", "RelayerError", "publicClient"],
      "Types": ["AccountState", "PendingChangeInfo", "TrackedChange", "GuardianCard", "ProofState", "RejectionStage", "VeraKeyError", "Session", "StoredPasskey"],
      "Action helpers": ["hashAction", "encodeAction", "changeDataHash", "changePayload", "guardianCommitment", "expectedClientDataPrefix", "computeNullifier", "appIdFromName", "fieldToHex", "countPublicKeyOccurrences", "ActionKind", "ChangeKind", "MAX_DEADLINE_WINDOW"],
      "WebAuthn helpers": ["createPasskey", "getAssertion", "getSpcAssertion", "spcAvailability", "formatSpcTotal", "webauthnDigest", "verifyPasskeySignature", "recoverPublicKeys", "publicKeyFromSpki", "derToLowS", "normalizeLowS", "prfSalt", "randomChallenge", "PrfUnsupportedError", "LocalPasskeyStore", "MemoryPasskeyStore"],
      "Disclosure helpers": ["verifyDisclosure", "linkDisclosureChallenge", "VerifyDisclosureOptions", "LinkStatement", "DisclosurePackage", "DisclosureVerdict", "LinkProver"],
      "Validator helpers": ["validatorInstallData", "validatorSignature", "validatorErc1271Challenge", "VALIDATOR_VERIFICATION_GAS"],
      "Sign-in helpers": ["VeraKeyConnect", "VeraKeyConnectError", "verifySignIn", "verifyPayment", "appIdFromOrigin", "accountAddressOf", "signInChallenge", "proveSignIn", "findPayment"],
    },
    load: () => import("./pages/reference/SdkReference"),
  },
  {
    path: "/docs/reference/contracts",
    title: "Contract reference",
    group: "Reference",
    description: "The functions, views, events and errors of the VeraKey account and factory, and the action and change kinds.",
    keywords: ["abi", "solidity interface", "functions", "events", "stylus", "account", "factory", "change kinds"],
    sections: ["Account functions", "Account views", "Account events", "Factory", "Change kinds", "Action kinds"],
    headingKeywords: {
      "Account functions": ["pay", "scheduleChange", "restrict", "applyChange", "cancelChange", "cancelRecovery", "guardianFreeze", "guardianCancelChange", "initiateRecovery", "guardianCancelRecovery", "executeRecovery", "initialize"],
      "Account views": ["actionHash", "nonce", "policy", "protections", "fees", "pendingChangeIds", "pendingChange", "recovery", "isOwner", "ownerCount", "ownerEpoch", "isRecipientAllowed", "isKnownRecipient", "config", "origin", "appId", "initialized"],
      "Account events": ["Initialized", "Paid", "ChangeScheduled", "ChangeApplied", "ChangeCancelled", "Restricted", "GuardianFroze", "RecoveryInitiated", "RecoveryExecuted", "RecoveryCancelled"],
      "Factory": ["createAccount", "accountAddress", "configHash"],
      "Change kinds": ["AddOwner", "RemoveOwner", "SetLimits", "SetRecipient", "SetAllowlist", "SetGuardian", "SetNewPayeeCap", "Freeze", "Unfreeze", "SetPaymentSheet"],
      "Action kinds": ["ACTION_TYPEHASH", "Pay", "ScheduleChange", "CancelChange", "CancelRecovery", "Restrict"],
    },
    load: () => import("./pages/reference/ContractReference"),
  },
  {
    path: "/docs/reference/errors",
    title: "Errors",
    group: "Reference",
    description: "Every error the account, the relayer and the SDK can return: what it means and what to do.",
    keywords: ["errors", "revert", "troubleshooting", "invalidclientdata", "http status", "rejection"],
    sections: ["Account errors", "Client data error codes", "Relayer errors", "SDK rejection stages"],
    subsections: ["Factory errors"],
    headingKeywords: {
      "Account errors": ["AccountFrozen", "AlreadyInitialized", "AlreadyOwner", "CannotVetoGuardianChange", "ChangeNotReady", "DailyCapExceeded", "DeadlineExpired", "DeadlineTooFar", "FeeTooHigh", "InvalidAmount", "InvalidChange", "InvalidClientData", "InvalidConfig", "InvalidProof", "InvalidRecipient", "LastOwner", "NewPayeeCapExceeded", "NoRecovery", "NotGuardian", "NotInitialized", "NotOwner", "NotRestrictive", "PaymentSheetRequired", "PerTxCapExceeded", "RecipientNotAllowed", "RecoveryNotReady", "TokenTransferFailed", "TooManyPendingChanges", "UnknownChange"],
      "Factory errors": ["InvalidIdentifier", "DeploymentFailed", "InitializationFailed"],
      "Client data error codes": ["TooLong", "NotAnAssertion", "ChallengeMismatch", "OriginMismatch", "Malformed", "CrossOrigin", "PaymentMismatch", "RpIdMismatch"],
      "Relayer errors": ["400", "402", "404", "409", "413", "422", "429", "500", "502", "503", "rate limit"],
      "SDK rejection stages": ["VeraKeyError", "funds", "authentication", "device", "proof", "policy", "relay"],
    },
    load: () => import("./pages/reference/Errors"),
  },
  {
    path: "/docs/reference/deployments",
    title: "Deployments",
    group: "Reference",
    description: "The live VeraKey contracts on Arbitrum Sepolia, the policy new accounts get, and how to verify the contracts yourself.",
    keywords: ["addresses", "contracts", "deployment", "arbitrum sepolia", "sourcify", "factory", "verifier"],
    sections: ["Arbitrum Sepolia", "Policy for new accounts", "This app's network", "Verify the contracts"],
    load: () => import("./pages/reference/Deployments"),
  },
  {
    path: "/docs/reference/glossary",
    title: "Glossary",
    group: "Reference",
    description: "Short definitions of the terms used across the VeraKey docs.",
    keywords: ["glossary", "terms", "definitions", "dictionary"],
    sections: ["Terms"],
    headingKeywords: {
      "Terms": ["Account", "Action hash", "Allowlist", "App", "appId", "Authenticator data", "Barretenberg", "Change delay", "clientDataJSON", "configHash", "CRS", "Daily cap", "Disclosure", "EIP-1167", "ERC-1271", "ERC-7579", "Fee recipient", "Guardian", "Guardian card", "maxFee", "New-recipient cap", "Nonce", "Nullifier", "Origin", "Owner epoch", "Passkey", "Payment sheet", "Per-payment cap", "Player ID", "PRF", "Proof", "Public inputs", "Recovery", "Recovery delay", "Relayer", "restrict", "rpId", "rpIdHash", "Scheduled change", "Sign in with VeraKey", "Stylus", "Timelock", "UltraHonk", "USDG", "User verification", "Verifier"],
    },
    load: () => import("./pages/reference/Glossary"),
  },
  {
    path: "/docs/reference/changelog",
    title: "Changelog",
    group: "Reference",
    description: "How VeraKey was built, milestone by milestone.",
    keywords: ["changelog", "history", "releases", "milestones", "what's new"],
    sections: ["2026-09-24", "2026-09-23"],
    load: () => import("./pages/reference/Changelog"),
  },
];

function normalize(path: string): string {
  const bare = path.split(/[?#]/)[0].replace(/\/+$/, "");
  return bare === "" ? "/" : bare;
}

export function findPage(path: string, pages: DocPage[] = PAGES): DocPage | undefined {
  const wanted = normalize(path);
  return pages.find(page => page.path === wanted);
}

export function neighbors(path: string, pages: DocPage[] = PAGES): { prev?: DocPage; next?: DocPage } {
  const index = pages.findIndex(page => page.path === normalize(path));
  return index < 0 ? {} : { prev: pages[index - 1], next: pages[index + 1] };
}

export function pagesByGroup(pages: DocPage[] = PAGES): { group: DocGroup; pages: DocPage[] }[] {
  return GROUPS.map(group => ({ group, pages: pages.filter(page => page.group === group) })).filter(g => g.pages.length > 0);
}

export const sectionHref = (page: Pick<DocPage, "path">, section: string) => `${page.path}#${slugify(section)}`;
