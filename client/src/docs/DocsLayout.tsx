import { ArrowLeft, ArrowRight, BookOpen, Menu, Search as SearchIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useLocation } from "wouter";
import { BrandMark } from "@/components/BrandMark";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { PreviewNotice } from "./components";
import { DOCS_UPDATED, neighbors, pagesByGroup, type DocPage } from "./registry";
import { DocsSearch } from "./Search";
import { fragmentId } from "./slug";

interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

/** The article's h2/h3 headings, kept current while the lazy page content renders. */
function useToc(article: RefObject<HTMLElement | null>, key: string): TocItem[] {
  const [items, setItems] = useState<TocItem[]>([]);
  useEffect(() => {
    const root = article.current;
    if (!root) return;
    const collect = () => {
      const next = [...root.querySelectorAll<HTMLElement>("h2[id], h3[id]")].map(h => ({
        id: h.id,
        text: h.dataset.title ?? h.textContent ?? "",
        level: (h.tagName === "H2" ? 2 : 3) as 2 | 3,
      }));
      setItems(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    collect();
    const observer = new MutationObserver(collect);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [article, key]);
  return items;
}

function useActiveHeading(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join("|");
  useEffect(() => {
    if (!ids.length) return setActive(null);
    const update = () => {
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 120) current = id;
      }
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
    // `key` stands for `ids`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

/** On a new page: scroll to the URL's #hash as soon as the lazy content renders it, else to the top. */
function useScrollOnNavigate(article: RefObject<HTMLElement | null>, key: string) {
  useEffect(() => {
    const hash = fragmentId(window.location.hash);
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }
    const tryScroll = () => {
      const target = document.getElementById(hash);
      target?.scrollIntoView();
      return !!target;
    };
    if (tryScroll() || !article.current) return;
    const observer = new MutationObserver(() => {
      if (tryScroll()) observer.disconnect();
    });
    observer.observe(article.current, { childList: true, subtree: true });
    const stop = setTimeout(() => observer.disconnect(), 5000);
    return () => {
      observer.disconnect();
      clearTimeout(stop);
    };
  }, [article, key]);
}

function setMetaDescription(content: string) {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "description";
    document.head.append(meta);
  }
  meta.content = content;
}

function Sidebar({ current, onNavigate }: { current?: string; onNavigate?: () => void }) {
  return (
    <nav className="dx-sidebar" aria-label="Documentation">
      {pagesByGroup().map(({ group, pages }) => (
        <div key={group} className="dx-nav-group">
          <p>{group}</p>
          <ul>
            {pages.map(page => (
              <li key={page.path}>
                <Link
                  href={page.path}
                  onClick={onNavigate}
                  className={page.path === current ? "is-active" : undefined}
                  aria-current={page.path === current ? "page" : undefined}
                >
                  {page.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function DocsLayout({ page, children }: { page?: DocPage; children: ReactNode }) {
  const [location] = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const article = useRef<HTMLElement>(null);
  const toc = useToc(article, location);
  const active = useActiveHeading(toc.map(item => item.id));
  useScrollOnNavigate(article, location);
  const { prev, next } = page ? neighbors(page.path) : {};

  useEffect(() => {
    document.title = page ? `${page.title} · VeraKey Docs` : "Page not found · VeraKey Docs";
    setMetaDescription(page?.description ?? "VeraKey documentation.");
  }, [page]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if ((event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="dx-root">
      <a className="dx-skip" href="#dx-content">Skip to content</a>
      <header className="dx-top">
        <div className="dx-top-inner">
          <button className="dx-menu" onClick={() => setNavOpen(true)} aria-label="Open the documentation menu">
            <Menu size={18} />
          </button>
          <Link href="/docs" className="dx-brand" aria-label="VeraKey Docs home">
            <BrandMark />
            <span className="brand-wordmark">Vera<span>Key</span></span>
            <span className="dx-brand-tag">Docs</span>
          </Link>
          <button className="dx-search-button" onClick={() => setSearchOpen(true)} aria-label="Search the docs">
            <SearchIcon size={14} />
            <span>Search docs…</span>
            <kbd>⌘K</kbd>
          </button>
          <nav className="dx-top-links" aria-label="Site">
            <Link href="/">Home</Link>
            <Link href="/app" className="dx-open-app">Open app</Link>
          </nav>
        </div>
      </header>
      <div className="dx-shell">
        <aside className="dx-side">
          <Sidebar current={page?.path} />
        </aside>
        <main className="dx-main" id="dx-content">
          <article className="dx-article" ref={article}>
            {page && (
              <header className="dx-page-head">
                <p className="dx-crumb">{page.group}</p>
                <h1>{page.title}</h1>
                <p className="dx-lead">{page.description}</p>
                {page.preview && <PreviewNotice />}
              </header>
            )}
            {children}
          </article>
          {page && (
            <footer className="dx-page-foot">
              <div className="dx-pager">
                {prev ? (
                  <Link href={prev.path} className="dx-prev">
                    <small><ArrowLeft size={12} /> Previous</small>
                    <span>{prev.title}</span>
                  </Link>
                ) : <span />}
                {next ? (
                  <Link href={next.path} className="dx-next">
                    <small>Next <ArrowRight size={12} /></small>
                    <span>{next.title}</span>
                  </Link>
                ) : <span />}
              </div>
              <p className="dx-updated">
                <BookOpen size={12} /> Last updated {DOCS_UPDATED}, checked against the code and the live deployment.
              </p>
            </footer>
          )}
        </main>
        <aside className="dx-toc" aria-label="On this page">
          {toc.length > 0 && (
            <>
              <p>On this page</p>
              <ul>
                {toc.map(item => (
                  <li key={item.id} className={`is-h${item.level}${item.id === active ? " is-active" : ""}`}>
                    <a href={`#${item.id}`}>{item.text}</a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="dx-drawer">
          <SheetTitle className="dx-drawer-title">VeraKey Docs</SheetTitle>
          <Sidebar current={page?.path} onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>
      <DocsSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
