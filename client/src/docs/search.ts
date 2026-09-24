import { GROUPS, PAGES, sectionHref, type DocGroup, type DocPage } from "./registry";

export interface SearchEntry {
  id: string;
  href: string;
  title: string;
  subtitle: string;
  group: DocGroup;
  keywords: string[];
}

/** One entry per page and one per h2 section (a deep link), in reading order. */
export function searchEntries(pages: DocPage[] = PAGES): SearchEntry[] {
  return pages.flatMap(page => [
    { id: page.path, href: page.path, title: page.title, subtitle: page.description, group: page.group, keywords: [page.group, ...page.keywords] },
    ...page.sections.map(section => {
      const href = sectionHref(page, section);
      return { id: href, href, title: section, subtitle: page.title, group: page.group, keywords: [page.title, ...page.keywords] };
    }),
  ]);
}

export function groupedEntries(entries: SearchEntry[]): { group: DocGroup; entries: SearchEntry[] }[] {
  return GROUPS.map(group => ({ group, entries: entries.filter(entry => entry.group === group) })).filter(g => g.entries.length > 0);
}
