import type { LucideIcon } from "lucide-react";
import { Check, Copy, ExternalLink, Info, Lightbulb, ShieldAlert, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { tokenize, type Lang } from "./highlight";
import { slugify } from "./slug";
import { textOf } from "./text";

function Heading({ level, id, children }: { level: 2 | 3; id?: string; children: ReactNode }) {
  const title = textOf(children);
  const anchor = id ?? slugify(title);
  const Tag = level === 2 ? "h2" : "h3";
  const copyLink = () => {
    navigator.clipboard?.writeText(`${location.origin}${location.pathname}#${anchor}`).then(() => toast("Link copied"), () => {});
  };
  return (
    <Tag id={anchor} data-title={title}>
      {children}
      <a className="dx-anchor" href={`#${anchor}`} onClick={copyLink} aria-label={`Link to “${title}”`}>#</a>
    </Tag>
  );
}
export const H2 = (props: { id?: string; children: ReactNode }) => <Heading level={2} {...props} />;
export const H3 = (props: { id?: string; children: ReactNode }) => <Heading level={3} {...props} />;

/** Internal routes use the router, same-page anchors stay plain, anything else opens a new tab. */
export function A({ href, children, className = "dx-link" }: { href: string; children: ReactNode; className?: string }) {
  if (href.startsWith("#")) return <a href={href} className={className}>{children}</a>;
  if (href.startsWith("/") && !href.startsWith("/api")) return <Link href={href} className={className}>{children}</Link>;
  return (
    <a href={href} className={className} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink size={11} aria-hidden className="dx-ext" />
    </a>
  );
}

const LANG_LABEL: Record<Lang, string> = { ts: "TypeScript", bash: "Shell", rust: "Rust", solidity: "Solidity", json: "JSON", text: "Text" };

export function Code({ lang = "text", title, children }: { lang?: Lang; title?: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const code = children.replace(/^\n+/, "").replace(/\s+$/, "");
  const copy = () =>
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => {});
  return (
    <figure className="dx-code">
      <figcaption>
        <span>{title ?? LANG_LABEL[lang]}</span>
        <button type="button" onClick={copy} aria-label="Copy code">
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <pre>
        <code>
          {tokenize(code, lang).map((token, i) =>
            token.type === "plain" ? token.text : <span key={i} className={`tk-${token.type}`}>{token.text}</span>
          )}
        </code>
      </pre>
    </figure>
  );
}

const CALLOUTS = {
  note: { icon: Info, label: "Note" },
  tip: { icon: Lightbulb, label: "Tip" },
  warning: { icon: TriangleAlert, label: "Warning" },
  security: { icon: ShieldAlert, label: "Security" },
} as const;

export function Callout({ kind = "note", title, children }: { kind?: keyof typeof CALLOUTS; title?: string; children: ReactNode }) {
  const { icon: Icon, label } = CALLOUTS[kind];
  return (
    <aside className={`dx-callout is-${kind}`}>
      <Icon size={16} aria-hidden />
      <div>
        <strong>{title ?? label}</strong>
        <div>{children}</div>
      </div>
    </aside>
  );
}

export const Steps = ({ children }: { children: ReactNode }) => <ol className="dx-steps">{children}</ol>;
export function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <H3>{title}</H3>
      {children}
    </li>
  );
}

export const Cards = ({ children }: { children: ReactNode }) => <div className="dx-cards">{children}</div>;
export function Card({ href, title, icon: Icon, children }: { href: string; title: string; icon?: LucideIcon; children: ReactNode }) {
  return (
    <A href={href} className="dx-card">
      {Icon && <Icon size={18} aria-hidden />}
      <strong>{title}</strong>
      <span>{children}</span>
    </A>
  );
}

/** `stack` turns each row into a labelled block on phones: use it for tables of prose. */
export function Table({ head, rows, stack = false }: { head: ReactNode[]; rows: ReactNode[][]; stack?: boolean }) {
  const labels = head.map(cell => textOf(cell));
  return (
    <div className={stack ? "dx-table-wrap is-stacked" : "dx-table-wrap"}>
      <table className="dx-table">
        <thead>
          <tr>{head.map((cell, i) => <th key={i}>{cell}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{row.map((cell, j) => <td key={j} data-label={stack ? labels[j] : undefined}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A numbered left-to-right flow (a column on phones). */
export function Flow({ steps }: { steps: { title: string; detail: string }[] }) {
  return (
    <ol className="dx-flow">
      {steps.map((step, i) => (
        <li key={step.title}>
          <span>{String(i + 1).padStart(2, "0")}</span>
          <strong>{step.title}</strong>
          <small>{step.detail}</small>
        </li>
      ))}
    </ol>
  );
}

/** Columns of components side by side (stacked on phones), e.g. where each part of the system runs. */
export function Lanes({ lanes }: { lanes: { title: string; items: { name: string; detail: string }[] }[] }) {
  return (
    <div className="dx-lanes">
      {lanes.map(lane => (
        <section key={lane.title}>
          <p className="dx-lane-title">{lane.title}</p>
          <ul>
            {lane.items.map(item => (
              <li key={item.name}>
                <strong>{item.name}</strong>
                <span>{item.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="dx-kbd">{children}</kbd>;
export const Badge = ({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "lime" | "orange" }) => (
  <span className={`dx-badge is-${tone}`}>{children}</span>
);

/** A contract or account address, linked to Arbiscan (Arbitrum Sepolia). */
export function Address({ value }: { value: string }) {
  return (
    <A href={`https://sepolia.arbiscan.io/address/${value}`} className="dx-link dx-address">
      <code>{value}</code>
    </A>
  );
}
