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
  load: () => Promise<{ default: ComponentType }>;
}

/** Every docs page in reading order: the sidebar, previous/next and search all follow it. */
export const PAGES: DocPage[] = [
  {
    path: "/docs",
    title: "Introduction",
    group: "Get started",
    description: "VeraKey gives every app its own USDG smart account behind one passkey, and proves each approval in zero knowledge, so no key links your accounts.",
    keywords: ["overview", "what is verakey", "passkey", "privacy", "arbitrum", "usdg"],
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
