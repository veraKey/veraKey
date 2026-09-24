import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { PreviewNotice } from "./components";
import { PAGES } from "./registry";
import { SDK_NPM_URL } from "./site";
import { slugify } from "./slug";

// Deployments reads the live configuration; these tests render it without one.
vi.mock("@/state/VeraKeyProvider", () => ({ useVeraKey: () => ({ config: null, configError: null }) }));

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'", "&nbsp;": " " };
const decode = (text: string) => text.replace(/&(?:amp|lt|gt|quot|#x27|#39|nbsp);/g, entity => ENTITIES[entity]);
const plain = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** Text as displayed, where highlighted code tokens sit side by side. */
const displayed = (html: string) => decode(html.replace(/<[^>]+>/g, ""));

async function render(path: string): Promise<string> {
  const page = PAGES.find(p => p.path === path);
  if (!page) throw new Error(`no page ${path}`);
  const { default: Page } = await page.load();
  return renderToStaticMarkup(<Router ssrPath={path}><Page /></Router>);
}

function headings(html: string, level: 2 | 3): { id: string; title: string }[] {
  return [...html.matchAll(new RegExp(`<h${level}\\b([^>]*)>`, "g"))].map(([, attrs]) => ({
    id: decode(/\bid="([^"]*)"/.exec(attrs)?.[1] ?? ""),
    title: decode(/\bdata-title="([^"]*)"/.exec(attrs)?.[1] ?? ""),
  }));
}

/** The plain text under each h2, keyed by the heading. */
function sections(html: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of html.split(/(?=<h2\b)/).slice(1)) {
    const title = decode(/\bdata-title="([^"]*)"/.exec(part)?.[1] ?? "");
    map.set(title, plain(part));
  }
  return map;
}

describe("the registry matches the pages", () => {
  it.each(PAGES.map(page => [page.path]))("%s lists its h2 and h3 headings", async path => {
    const page = PAGES.find(p => p.path === path)!;
    const html = await render(path);
    const h2 = headings(html, 2);
    const h3 = headings(html, 3);
    expect(page.sections).toEqual(h2.map(h => h.title));
    expect(page.subsections ?? []).toEqual(h3.map(h => h.title));
    // Search links to slugify(title), so every heading's id must be exactly that.
    for (const heading of [...h2, ...h3]) expect(heading.id).toBe(slugify(heading.title));
    // Every search term filed under a heading appears on the page.
    const text = plain(html);
    for (const [heading, terms] of Object.entries(page.headingKeywords ?? {})) {
      expect([...page.sections, ...(page.subsections ?? [])]).toContain(heading);
      for (const term of terms) expect(text, `${path}: ${term}`).toContain(term);
    }
  });
});

describe("what the docs tell people", () => {
  it("tells sites to verify on their server, use each nonce once, pin the deployment and keep the popup's opener", async () => {
    const text = plain(await render("/docs/build/sign-in"));
    for (const phrase of ["verifySignIn", "nonce", "Referrer-Policy", "same-origin-allow-popups", "Deployments"]) expect(text).toContain(phrase);
    expect(plain(await render("/docs/concepts"))).toMatch(/Sign in with VeraKey/);
    expect(await render("/docs/reference/glossary")).toMatch(/<dt>Player ID<\/dt>/);
  });

  it("says the player ID identifies a player but is not a secret", async () => {
    expect(plain(await render("/docs/build/sign-in"))).toMatch(/not a secret/);
    for (const page of PAGES) expect(plain(await render(page.path))).not.toMatch(/only (your site|it|this game) knows/);
  });

  it("promises a site's players only the protections they get, and says they cannot withdraw yet", async () => {
    const text = plain(await render("/docs/build/sign-in"));
    expect(text).not.toMatch(/allowlist/);
    expect(text).toMatch(/cannot yet[^.]*withdraw/);
  });

  it("tells sites to bind each nonce to the browser session and to keep their origin", async () => {
    const text = plain(await render("/docs/build/sign-in"));
    expect(text).toMatch(/browser session/);
    expect(text).toMatch(/www\./);
  });

  it("explains what makes the popup unavailable, and how a page keeps cross-origin isolation", async () => {
    const text = plain(await render("/docs/build/sign-in"));
    expect(text).toMatch(/VeraKey URL/);
    expect(text).toContain("Document-Isolation-Policy");
  });

  it("tells sites how to find a payment the popup was sending, and to tie payments to the signed-in player", async () => {
    const text = displayed(await render("/docs/build/sign-in"));
    for (const phrase of ["findPayment", "error.pending", "account: session.account"]) expect(text).toContain(phrase);
  });

  it("the quickstart deploys and funds the account before it pays", async () => {
    const text = displayed(await render("/docs/build/quickstart"));
    const deploy = text.indexOf("ensureAccount(");
    const fund = text.indexOf("requestDemoFunds(");
    const pay = text.indexOf("vera.pay(");
    expect(deploy).toBeGreaterThan(-1);
    expect(fund).toBeGreaterThan(deploy);
    expect(pay).toBeGreaterThan(fund);
  });

  it("a guardian whose recovery nobody cancels takes over the account", async () => {
    const recovery = plain(await render("/docs/guides/recovery"));
    expect(recovery).not.toContain("Move funds, or make payments");
    expect(recovery).toMatch(/nobody cancels/i);
    const security = await render("/docs/security");
    expect(plain(security)).not.toMatch(/never hold the account/i);
    expect(sections(security).get("What VeraKey protects")).toMatch(/guardian/i);
  });

  it("says the caps never stop the owners from freezing or vetoing, and what a change to the guardian waits for", async () => {
    const security = plain(await render("/docs/security"));
    expect(security).toMatch(/never refused because of the caps/);
    expect(security).toMatch(/cancels a recovery the previous guardian started/);
    const reference = plain(await render("/docs/reference/contracts"));
    expect(reference).toMatch(/maxFee ≤ perTxCap ≤ dailyCap/);
    expect(reference).not.toMatch(/replacing or removing one waits/);
    expect(sections(await render("/docs/guides/recovery")).get("Name a guardian")).toMatch(/recovery delay/);
    expect(plain(await render("/docs/security/review"))).toMatch(/Nemesis/);
  });

  it("a disclosure reveals the link to anyone who gets the file, for good", async () => {
    for (const path of ["/docs/guides/disclosures", "/docs/build/disclosures", "/docs/reference/glossary", "/docs/security"]) {
      expect(plain(await render(path)), path).not.toMatch(/only to them|useless to its new holder|It fails under any other audience name/i);
    }
    expect(plain(await render("/docs/guides/disclosures"))).toMatch(/permanent/i);
    expect(plain(await render("/docs/build/disclosures"))).toMatch(/permanent/i);
  });

  it("tells developers to install the public SDK, and what works without a deployment of their own", async () => {
    const quickstart = displayed(await render("/docs/build/quickstart"));
    expect(quickstart).toContain("npm install @verakey/sdk");
    expect(quickstart).not.toContain("__BB_CRS_HOST__"); // only VeraKey's own build of bb.js reads it
    expect(quickstart).toMatch(/Aztec's CDN/);
    expect(displayed(await render("/docs/build/sign-in"))).toContain("npm install @verakey/sdk");
    for (const page of PAGES) expect(plain(await render(page.path)), page.path).not.toMatch(/SDK becomes available|SDK and developer access open/);
    const notice = plain(renderToStaticMarkup(<PreviewNotice />));
    expect(notice).toContain("npm install @verakey/sdk");
    expect(notice).toMatch(/Sign in with VeraKey works/);
    expect(notice).toMatch(/deployment for your domain/);
    const modules = plain(await render("/docs/build/sdk"));
    for (const module of ["@verakey/sdk/connect", "@verakey/sdk/signin"]) expect(modules).toContain(module);
  });

  it("links the SDK's public npm page wherever the docs name the package", async () => {
    const link = `href="${SDK_NPM_URL}"`;
    // Developer pages show the preview notice, so it carries the link for them; other pages link it themselves.
    expect(renderToStaticMarkup(<PreviewNotice />)).toContain(link);
    for (const page of PAGES) {
      const html = await render(page.path);
      if (html.includes("@verakey/sdk") && !page.preview) expect(html, page.path).toContain(link);
    }
    // Where the docs say how to get the SDK, the page links it directly.
    for (const path of ["/docs/build/quickstart", "/docs/build/sign-in", "/docs/build/sdk", "/docs/reference/sdk", "/docs/reference/changelog"]) {
      expect(await render(path), path).toContain(link);
    }
  });

  it("presents VeraKey as a hosted product: no repository, open source, self-hosting or build tooling", async () => {
    const SELF_HOSTED = [
      /repositor/i, /open[- ]source/i, /github/i, /git clone/i, /\bpnpm\b/i, /workspace/i, /docker/i, /railway/i,
      /cloudflared|tunnel/i, /self-host/i, /\.env\b/, /environment variable/i, /\bREADME\b/, /\bCI\b/,
      /\b(nargo|cargo|forge)\b/, /\b(packages|scripts|server|circuits|deployments)\//, /contracts\/(stylus|evm)/,
      /devnode/i, /public issue/i,
    ];
    const found: string[] = [];
    for (const page of PAGES) {
      const text = displayed(await render(page.path));
      for (const pattern of SELF_HOSTED) {
        const match = text.match(pattern);
        if (match) found.push(`${page.path}: "${text.slice(Math.max(0, (match.index ?? 0) - 30), (match.index ?? 0) + 40)}"`);
      }
    }
    expect(found).toEqual([]);
  });

  it("marks exactly the developer pages as a preview", () => {
    const preview = PAGES.filter(page => page.preview).map(page => page.path);
    expect(preview).toEqual([...PAGES.filter(page => page.group === "Build").map(page => page.path), "/docs/reference/sdk"]);
  });

  it("says Set only schedules a guardian, and every scheduled change waits for Apply", async () => {
    expect(plain(await render("/docs/guides/protect"))).not.toMatch(/does it for you/i);
    const guardian = sections(await render("/docs/guides/recovery")).get("Name a guardian") ?? "";
    expect(guardian).toMatch(/change delay/i);
    expect(guardian).toMatch(/Apply/);
  });

  it("tells someone recovering an account what they need and what the app cannot do yet", async () => {
    const recover = sections(await render("/docs/guides/recovery")).get("Recover an account") ?? "";
    expect(recover).toMatch(/64 hex/i);
    expect(recover).toMatch(/frozen/i);
    expect(recover).toMatch(/cannot yet/i);
  });

  it("tells developers that the session they get back holds the PRF secret", async () => {
    const text = plain(await render("/docs/build/sdk"));
    expect(text).not.toMatch(/nothing else ever holds it/i);
    expect(text).toMatch(/never persist/i);
  });

  it("says what an app is", async () => {
    expect(plain(await render("/docs"))).not.toMatch(/every app you use/i);
    expect(await render("/docs/reference/glossary")).toMatch(/<dt>App<\/dt>/);
  });
});
