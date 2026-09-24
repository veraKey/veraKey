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
