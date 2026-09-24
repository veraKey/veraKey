import { GROUPS, PAGES, sectionHref, type DocGroup, type DocPage } from "./registry";

export interface SearchEntry {
  id: string;
  href: string;
  /** The page title, or the heading. */
  title: string;
  /** A page's description, or a heading's page title. */
  subtitle: string;
  group: DocGroup;
  kind: "page" | "heading";
  /** Terms that should find this entry. */
  keywords: string[];
  /** Weaker context: a page's group, or a heading's page title and group. */
  context: string;
}

/** One entry per page and one per h2 and h3 heading (a deep link), in reading order. */
export function searchEntries(pages: DocPage[] = PAGES): SearchEntry[] {
  return pages.flatMap(page => {
    const heading = (title: string): SearchEntry => {
      const href = sectionHref(page, title);
      return {
        id: href, href, title, subtitle: page.title, group: page.group, kind: "heading",
        keywords: page.headingKeywords?.[title] ?? [], context: `${page.title} ${page.group}`,
      };
    };
    return [
      { id: page.path, href: page.path, title: page.title, subtitle: page.description, group: page.group, kind: "page" as const, keywords: page.keywords, context: page.group },
      ...page.sections.map(heading),
      ...(page.subsections ?? []).map(heading),
    ];
  });
}

export function groupedEntries(entries: SearchEntry[]): { group: DocGroup; entries: SearchEntry[] }[] {
  return GROUPS.map(group => ({ group, entries: entries.filter(entry => entry.group === group) })).filter(g => g.entries.length > 0);
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from", "how", "i", "in", "is", "it",
  "my", "of", "on", "or", "the", "to", "what", "when", "why", "with", "you", "your",
]);

const words = (text: string) =>
  text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Drops filler words, unless that would leave nothing. */
const meaningful = (list: string[]) => {
  const kept = list.filter(word => !STOPWORDS.has(word));
  return kept.length ? kept : list;
};

/** 3 for a whole word, 2 for a word that starts with the term, 1 for a longer term inside a word. */
function termScore(term: string, candidates: string[]): number {
  let best = 0;
  for (const word of candidates) {
    if (word === term) return 3;
    if (word.startsWith(term)) best = 2;
    else if (best === 0 && term.length >= 4 && word.includes(term)) best = 1;
  }
  return best;
}

/**
 * The entries that match every word of `query`, best first. A match in a title or heading outranks one in the
 * keywords, which outranks the page and group, which outranks a page's description. A heading that is exactly
 * the query comes first, and a page beats a heading that only starts with the query.
 */
export function rankEntries(query: string, entries: SearchEntry[]): SearchEntry[] {
  const terms = meaningful(words(query));
  if (!terms.length) return [];
  const phrase = terms.join(" ");
  const ranked: { entry: SearchEntry; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const title = words(entry.title);
    const fields: [string[], number][] = [
      [title, 10],
      [entry.keywords.flatMap(words), 6],
      [words(entry.context), 3],
      [entry.kind === "page" ? words(entry.subtitle) : [], 1],
    ];
    let score = 0;
    for (const term of terms) {
      const best = Math.max(...fields.map(([candidates, weight]) => termScore(term, candidates) * weight));
      if (best === 0) return;
      score += best;
    }
    const heading = meaningful(title).join(" ");
    if (heading === phrase) score += 60;
    else if (heading.startsWith(phrase)) score += 10;
    if (entry.kind === "page") score += 15;
    ranked.push({ entry, score, index });
  });
  return ranked.sort((a, b) => b.score - a.score || a.index - b.index).map(r => r.entry);
}
