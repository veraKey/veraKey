import { describe, expect, it } from "vitest";
import { articleMarkdown, htmlToMarkdown } from "./markdown";

const PAGE = "https://verakey.mdloglabs.org/docs/build/sign-in";
const md = (html: string) => htmlToMarkdown(html, PAGE);

describe("docs HTML as Markdown", () => {
  it("keeps headings by their titles, without their anchor links", () => {
    const html =
      `<h1>Sign in</h1><h2 id="develop-locally" data-title="Develop locally">Develop locally<a class="dx-anchor" href="#develop-locally">#</a></h2>` +
      `<h3 id="accounts" data-title="Accounts">Accounts<a class="dx-anchor" href="#accounts">#</a></h3>`;
    expect(md(html)).toBe("# Sign in\n\n## Develop locally\n\n### Accounts\n");
  });

  it("writes inline code, emphasis and absolute links, and drops icons", () => {
    const html =
      `<p>Use <code>verifySignIn</code> on <strong>your</strong>   server; see <a href="/docs/reference/deployments">Deployments</a>, ` +
      `<a href="#errors-and-limits">errors</a> and <a href="https://www.npmjs.com/package/@verakey/sdk" target="_blank">npm<svg><path d=""></path></svg></a>.</p>`;
    expect(md(html)).toBe(
      "Use `verifySignIn` on **your** server; see [Deployments](https://verakey.mdloglabs.org/docs/reference/deployments), " +
        "[errors](https://verakey.mdloglabs.org/docs/build/sign-in#errors-and-limits) and [npm](https://www.npmjs.com/package/@verakey/sdk).\n"
    );
  });

  it("escapes text that a Markdown renderer would take for an HTML tag, but not code", () => {
    expect(md("<p>() =&gt; Promise&lt;VeraKeyProver&gt; and a &lt; b</p>")).toBe("() => Promise\\<VeraKeyProver> and a < b\n");
    expect(md("<p><code>Promise&lt;T&gt;</code></p>")).toBe("`Promise<T>`\n");
  });

  it("writes lists, numbered lists, and a list item's later blocks indented under it", () => {
    expect(md("<ul><li>One</li><li>Two <code>2</code></li></ul>")).toBe("- One\n- Two `2`\n");
    expect(md("<ol><li>First</li><li>Second</li></ol>")).toBe("1. First\n2. Second\n");
    expect(md(`<ol class="dx-steps"><li><h3 data-title="Install">Install<a class="dx-anchor" href="#install">#</a></h3><p>Run it.</p></li></ol>`))
      .toBe("1. ### Install\n\n   Run it.\n");
  });

  it("fences code with its language and title, exactly as written", () => {
    const html =
      `<figure class="dx-code" data-lang="ts" data-title="game.ts"><figcaption><span>game.ts</span><button>Copy</button></figcaption>` +
      `<pre><code><span class="tk-keyword">const</span> a = f&lt;T&gt;(1);\n  b();</code></pre></figure>`;
    expect(md(html)).toBe('```ts title="game.ts"\nconst a = f<T>(1);\n  b();\n```\n');
    const untitled = `<figure class="dx-code" data-lang="bash"><figcaption><span>Shell</span></figcaption><pre><code>npm install @verakey/sdk</code></pre></figure>`;
    expect(md(untitled)).toBe("```bash\nnpm install @verakey/sdk\n```\n");
  });

  it("turns tables into Markdown tables, one line per row", () => {
    const html =
      `<div class="dx-table-wrap"><table><thead><tr><th>code</th><th>What happened</th></tr></thead>` +
      `<tbody><tr><td><code>request</code></td><td>A | B<br>C</td></tr></tbody></table></div>`;
    expect(md(html)).toBe("| code | What happened |\n| --- | --- |\n| `request` | A \\| B C |\n");
  });

  it("quotes callouts with their title", () => {
    const html =
      `<aside class="dx-callout is-tip"><svg></svg><div><strong>No deployment?</strong>` +
      `<div>Start with <a href="/docs/build/sign-in">Sign in</a>.</div></div></aside>`;
    expect(md(html)).toBe("> **No deployment?** Start with [Sign in](https://verakey.mdloglabs.org/docs/build/sign-in).\n");
  });

  it("writes cards as links, flows as numbered steps, lanes and glossaries as terms", () => {
    const cards = `<div class="dx-cards"><a class="dx-card" href="/docs/build/sdk"><svg></svg><strong>SDK guide</strong><span>In depth.</span></a></div>`;
    expect(md(cards)).toBe("- [SDK guide](https://verakey.mdloglabs.org/docs/build/sdk): In depth.\n");
    const flow = `<ol class="dx-flow"><li><span>01</span><strong>Unlock</strong><small>The passkey signs.</small></li></ol>`;
    expect(md(flow)).toBe("1. **Unlock**: The passkey signs.\n");
    const lanes = `<div class="dx-lanes"><section><p class="dx-lane-title">Browser</p><ul><li><strong>Prover</strong><span>Makes proofs.</span></li></ul></section></div>`;
    expect(md(lanes)).toBe("**Browser**\n\n- **Prover**: Makes proofs.\n");
    expect(md("<dl><dt>Player ID</dt><dd>A site's ID for a player.</dd></dl>")).toBe("- **Player ID**: A site's ID for a player.\n");
    // The glossary wraps each term in a div, to link to it.
    expect(md(`<dl><div id="app"><dt>App</dt><dd>A site.</dd></div><div id="nullifier"><dt>Nullifier</dt><dd>An ID.</dd></div></dl>`))
      .toBe("- **App**: A site.\n- **Nullifier**: An ID.\n");
  });

  it("reads a docs page's article: its title, lead and content, without the breadcrumb or the page chrome", () => {
    const html =
      `<div class="dx-root"><header class="dx-top"><a href="/docs">Docs</a></header><nav class="dx-sidebar"><a href="/docs/concepts">Concepts</a></nav>` +
      `<article class="dx-article"><header class="dx-page-head"><p class="dx-crumb">Build</p><h1>Sign in with VeraKey</h1>` +
      `<p class="dx-lead">Let players sign in.</p></header><!--$--><h2 data-title="How sign-in works">How sign-in works</h2><p>Text.</p><!--/$--></article></div>`;
    expect(articleMarkdown(html, PAGE)).toBe("# Sign in with VeraKey\n\nLet players sign in.\n\n## How sign-in works\n\nText.\n");
    expect(() => articleMarkdown("<div></div>", PAGE)).toThrow(/article/);
  });
});
