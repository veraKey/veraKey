import { lazy, Suspense } from "react";
import { useLocation } from "wouter";
import { DocsLayout } from "./DocsLayout";
import { NotFoundDoc } from "./NotFoundDoc";
import { PAGES, findPage } from "./registry";
import "./docs.css";

const CONTENT = new Map(PAGES.map(page => [page.path, lazy(page.load)]));

/** /docs and /docs/*: the page's content inside the docs shell. Never loads the prover. */
export default function DocsSite() {
  const [location] = useLocation();
  const page = findPage(location);
  const Content = page ? CONTENT.get(page.path) : undefined;
  return (
    <DocsLayout page={page}>
      <Suspense fallback={<p className="dx-loading">Loading…</p>}>{Content ? <Content /> : <NotFoundDoc />}</Suspense>
    </DocsLayout>
  );
}
