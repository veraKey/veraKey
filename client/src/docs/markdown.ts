import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

// The docs as Markdown, for readers without a browser: AI assistants, llms.txt and terminals. It handles the
// elements the docs components render (components.tsx), and makes every link absolute against the page's URL.

type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];

const isElement = (node: Node): node is Element => "tagName" in node;
const attr = (el: Element, name: string) => el.attrs.find(a => a.name === name)?.value;
const hasClass = (el: Element, name: string) => (attr(el, "class") ?? "").split(/\s+/).includes(name);
const children = (el: Element) => el.childNodes.filter(isElement);

/** Icons, controls, heading anchors and the breadcrumb: nothing a reader of the text needs. */
const SKIPPED_TAGS = new Set(["svg", "button", "script", "style", "template"]);
const SKIPPED_CLASSES = ["dx-anchor", "dx-crumb", "dx-skip"];
const skipped = (el: Element) => SKIPPED_TAGS.has(el.tagName) || SKIPPED_CLASSES.some(name => hasClass(el, name));

const INLINE_TAGS = new Set(["a", "abbr", "b", "br", "code", "em", "i", "kbd", "small", "span", "strong", "sub", "sup"]);
const isBlock = (node: Node) => isElement(node) && !INLINE_TAGS.has(node.tagName) && !SKIPPED_TAGS.has(node.tagName);

/** Every character of text under `node`, as written: for code. */
function textOf(node: Node): string {
  if (node.nodeName === "#text") return (node as DefaultTreeAdapterMap["textNode"]).value;
  return isElement(node) ? node.childNodes.map(textOf).join("") : "";
}

function find(el: Element, test: (el: Element) => boolean): Element | undefined {
  for (const child of children(el)) {
    if (test(child)) return child;
    const found = find(child, test);
    if (found) return found;
  }
  return undefined;
}

function findAll(el: Element, test: (el: Element) => boolean): Element[] {
  return children(el).flatMap(child => (test(child) ? [child] : findAll(child, test)));
}

function codeSpan(text: string): string {
  const ticks = text.includes("`") ? "``" : "`";
  return ticks.length > 1 ? `${ticks} ${text} ${ticks}` : `\`${text}\``;
}

function fence(code: string, info: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map(run => run.length));
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}${info}\n${code.replace(/\n+$/, "")}\n${ticks}`;
}

class Converter {
  constructor(private readonly base: string) {}

  /** Inline content on one line, with runs of whitespace collapsed. */
  inline(nodes: Node[]): string {
    let out = "";
    for (const node of nodes) {
      // A "<" that could open a tag, such as Promise<Prover> in prose, would vanish in a rendered Markdown view.
      if (node.nodeName === "#text") out += (node as DefaultTreeAdapterMap["textNode"]).value.replace(/\s+/g, " ").replace(/<(?=[A-Za-z/!?])/g, "\\<");
      else if (isElement(node) && !skipped(node)) out += this.inlineElement(node);
    }
    return out.replace(/ {2,}/g, " ");
  }

  private inlineElement(el: Element): string {
    const text = () => this.inline(el.childNodes).trim();
    switch (el.tagName) {
      case "code":
      case "kbd":
        return codeSpan(textOf(el));
      case "strong":
      case "b":
        return text() ? `**${text()}**` : "";
      case "em":
      case "i":
        return text() ? `*${text()}*` : "";
      case "br":
        return " ";
      case "a": {
        const href = attr(el, "href");
        if (!text()) return "";
        return href ? `[${text()}](${new URL(href, this.base).toString()})` : text();
      }
      default:
        return this.inline(el.childNodes);
    }
  }

  /** Markdown blocks: runs of inline content become paragraphs. */
  blocks(nodes: Node[]): string[] {
    const out: string[] = [];
    let run: Node[] = [];
    const flush = () => {
      const paragraph = this.inline(run).trim();
      if (paragraph) out.push(paragraph);
      run = [];
    };
    for (const node of nodes) {
      if (isBlock(node)) {
        flush();
        if (!skipped(node as Element)) out.push(...this.block(node as Element));
      } else {
        run.push(node);
      }
    }
    flush();
    return out;
  }

  private block(el: Element): string[] {
    switch (el.tagName) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
        return [`${"#".repeat(Number(el.tagName[1]))} ${attr(el, "data-title") ?? this.inline(el.childNodes).trim()}`];
      case "p": {
        const paragraph = this.inline(el.childNodes).trim();
        return paragraph ? [paragraph] : [];
      }
      case "ul":
      case "ol":
        return [this.list(el)];
      case "dl":
        return [this.definitions(el)];
      case "figure":
        return hasClass(el, "dx-code") ? [this.code(el)] : this.blocks(el.childNodes);
      case "pre":
        return [fence(textOf(el), "")];
      case "table":
        return [this.table(el)];
      case "aside":
        return hasClass(el, "dx-callout") ? [this.callout(el)] : this.blocks(el.childNodes);
      default:
        if (hasClass(el, "dx-cards")) return [this.cards(el)];
        if (hasClass(el, "dx-lanes")) return this.lanes(el);
        return this.blocks(el.childNodes);
    }
  }

  private list(el: Element): string {
    const ordered = el.tagName === "ol";
    return children(el)
      .filter(li => li.tagName === "li")
      .map((li, i) => {
        const marker = ordered ? `${i + 1}. ` : "- ";
        const parts = hasClass(el, "dx-flow") ? [this.term(li)] : this.blocks(li.childNodes);
        const indent = " ".repeat(marker.length);
        const lines = parts.join("\n\n").split("\n");
        return marker + lines.map((line, j) => (j === 0 || line === "" ? line : indent + line)).join("\n");
      })
      .join("\n");
  }

  /** A flow step or a lane item: its name in bold, then its detail (a flow step's number comes before its name). */
  private term(el: Element): string {
    const items = children(el);
    const at = items.findIndex(child => child.tagName === "strong");
    const name = items[at];
    const detail = items.slice(at + 1).find(child => child.tagName === "small" || child.tagName === "span");
    return `**${name ? this.inline(name.childNodes).trim() : ""}**: ${detail ? this.inline(detail.childNodes).trim() : ""}`;
  }

  private definitions(el: Element): string {
    const items: string[] = [];
    // In document order, also when a div wraps each term and its definition.
    for (const child of findAll(el, item => item.tagName === "dt" || item.tagName === "dd")) {
      if (child.tagName === "dt") items.push(`- **${this.inline(child.childNodes).trim()}**`);
      else if (child.tagName === "dd" && items.length) items[items.length - 1] += `: ${this.inline(child.childNodes).trim()}`;
    }
    return items.join("\n");
  }

  private code(el: Element): string {
    const pre = find(el, child => child.tagName === "pre");
    const title = attr(el, "data-title");
    return fence(pre ? textOf(pre) : "", `${attr(el, "data-lang") ?? ""}${title ? ` title="${title}"` : ""}`);
  }

  private table(el: Element): string {
    const rows = findAll(el, child => child.tagName === "tr").map(tr =>
      children(tr)
        .filter(cell => cell.tagName === "th" || cell.tagName === "td")
        .map(cell => this.inline(cell.childNodes).trim().replace(/\|/g, "\\|"))
    );
    const [head = [], ...body] = rows;
    return [head, head.map(() => "---"), ...body].map(row => `| ${row.join(" | ")} |`).join("\n");
  }

  private callout(el: Element): string {
    const box = children(el).find(child => child.tagName === "div");
    const title = box && children(box).find(child => child.tagName === "strong");
    const body = box ? this.blocks(box.childNodes.filter(node => node !== title)) : [];
    const heading = title ? `**${this.inline(title.childNodes).trim()}**` : "";
    const [first = "", ...rest] = body;
    const text = [[heading, first].filter(Boolean).join(" "), ...rest].join("\n\n");
    return text.split("\n").map(line => (line ? `> ${line}` : ">")).join("\n");
  }

  private cards(el: Element): string {
    return findAll(el, child => hasClass(child, "dx-card"))
      .map(card => {
        const title = find(card, child => child.tagName === "strong");
        const summary = find(card, child => child.tagName === "span");
        const link = `[${title ? this.inline(title.childNodes).trim() : ""}](${new URL(attr(card, "href") ?? "", this.base).toString()})`;
        return `- ${link}${summary ? `: ${this.inline(summary.childNodes).trim()}` : ""}`;
      })
      .join("\n");
  }

  private lanes(el: Element): string[] {
    return children(el).flatMap(lane => {
      const title = find(lane, child => hasClass(child, "dx-lane-title"));
      const items = findAll(lane, child => child.tagName === "li").map(li => `- ${this.term(li)}`);
      return [`**${title ? this.inline(title.childNodes).trim() : ""}**`, items.join("\n")];
    });
  }
}

const markdown = (blocks: string[]) => (blocks.length ? `${blocks.join("\n\n")}\n` : "");

/** An HTML fragment as Markdown; links resolve against `pageUrl`. */
export function htmlToMarkdown(html: string, pageUrl: string): string {
  return markdown(new Converter(pageUrl).blocks(parseFragment(html).childNodes));
}

/** A rendered docs page's article (its title, lead and content) as Markdown, without the site's navigation. */
export function articleMarkdown(html: string, pageUrl: string): string {
  const root = parseFragment(html);
  const article = root.childNodes.filter(isElement).map(el => (hasClass(el, "dx-article") ? el : find(el, child => hasClass(child, "dx-article")))).find(Boolean);
  if (!article) throw new Error("the page has no docs article");
  return markdown(new Converter(pageUrl).blocks(article.childNodes));
}
