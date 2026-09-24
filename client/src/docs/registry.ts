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
export const PAGES: DocPage[] = [];

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
