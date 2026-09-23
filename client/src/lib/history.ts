import type { TrackedChange } from "@verakey/sdk/client";
import type { Address, Hex } from "viem";

/** Receipts and scheduled changes this browser initiated (display only; the chain is the truth). */
export interface ActivityItem {
  hash: Hex;
  appKey: string;
  kind: "pay" | "change" | "cancel" | "apply" | "recovery";
  label: string;
  amount?: string;
  to?: Address;
  gasUsed?: string;
  provingMs?: number;
  publicKeyOccurrences?: number;
  at: number;
}

const ACTIVITY_KEY = "verakey.activity.v1";
const CHANGES_KEY = "verakey.changes.v1";

function read<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
}

function write<T>(key: string, items: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Storage unavailable (private mode): history is a convenience only.
  }
}

export const activity = {
  list: () => read<ActivityItem>(ACTIVITY_KEY),
  add(item: ActivityItem) {
    write(ACTIVITY_KEY, [item, ...read<ActivityItem>(ACTIVITY_KEY)].slice(0, 30));
  },
};

export const trackedChanges = {
  list: (account?: Address) =>
    read<TrackedChange>(CHANGES_KEY).filter(c => !account || c.account.toLowerCase() === account.toLowerCase()),
  add(change: TrackedChange) {
    write(CHANGES_KEY, [change, ...read<TrackedChange>(CHANGES_KEY).filter(c => c.changeId !== change.changeId)]);
  },
  remove(changeId: Hex) {
    write(CHANGES_KEY, read<TrackedChange>(CHANGES_KEY).filter(c => c.changeId !== changeId));
  },
};
