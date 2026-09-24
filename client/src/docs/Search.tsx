import { useMemo } from "react";
import { useLocation } from "wouter";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { groupedEntries, searchEntries } from "./search";

export function DocsSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [location, navigate] = useLocation();
  const groups = useMemo(() => groupedEntries(searchEntries()), []);
  const go = (href: string) => {
    onOpenChange(false);
    const [path, hash] = href.split("#");
    if (path === location && hash) {
      history.replaceState(null, "", href);
      document.getElementById(hash)?.scrollIntoView();
    } else {
      navigate(href);
    }
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search the docs" description="Find a page or a section." className="dx-search">
      <CommandInput placeholder="Search the docs…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {groups.map(({ group, entries }) => (
          <CommandGroup key={group} heading={group}>
            {entries.map(entry => (
              <CommandItem key={entry.id} value={entry.id} keywords={[entry.title, entry.subtitle, ...entry.keywords]} onSelect={() => go(entry.href)} data-href={entry.href}>
                <span className="dx-search-title">{entry.title}</span>
                <span className="dx-search-sub">{entry.subtitle}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
