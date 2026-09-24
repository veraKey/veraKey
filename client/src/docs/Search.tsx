import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { groupedEntries, rankEntries, searchEntries, type SearchEntry } from "./search";

/** Results shown for a query; the ranking puts the useful ones first. */
const MAX_RESULTS = 40;

export function DocsSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [location, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const entries = useMemo(() => searchEntries(), []);
  const groups = useMemo(() => groupedEntries(entries), [entries]);
  const results = useMemo(() => rankEntries(query, entries).slice(0, MAX_RESULTS), [query, entries]);
  const setOpen = (next: boolean) => {
    if (!next) setQuery("");
    onOpenChange(next);
  };
  const go = (href: string) => {
    setOpen(false);
    const [path, hash] = href.split("#");
    if (path === location && hash) {
      history.replaceState(null, "", href);
      document.getElementById(hash)?.scrollIntoView();
    } else {
      navigate(href);
    }
  };
  const item = (entry: SearchEntry) => (
    <CommandItem key={entry.id} value={entry.id} onSelect={() => go(entry.href)} data-href={entry.href}>
      <span className="dx-search-title">{entry.title}</span>
      <span className="dx-search-sub">{entry.subtitle}</span>
    </CommandItem>
  );
  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      shouldFilter={false}
      title="Search the docs"
      description="Find a page or a section."
      className="dx-search"
    >
      <CommandInput placeholder="Search the docs…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {query.trim()
          ? results.length > 0 && <CommandGroup heading="Best matches">{results.map(item)}</CommandGroup>
          : groups.map(({ group, entries: inGroup }) => (
              <CommandGroup key={group} heading={group}>
                {inGroup.map(item)}
              </CommandGroup>
            ))}
      </CommandList>
    </CommandDialog>
  );
}
