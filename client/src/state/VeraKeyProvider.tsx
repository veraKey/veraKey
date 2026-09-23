import type { NetworkConfig } from "@shared/api";
import { VeraKeyClient, type AccountState, type Session } from "@verakey/sdk/client";
import type { StoredPasskey } from "@verakey/sdk/store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEMO_APPS, type DemoApp } from "@/lib/apps";
import { loadNetworkConfig } from "@/lib/config";

export type ProverStatus = "idle" | "loading" | "ready" | "error";
type Accounts = Partial<Record<DemoApp["key"], AccountState>>;

interface VeraKeyContextValue {
  config: NetworkConfig | null;
  configError: string | null;
  client: VeraKeyClient | null;
  passkeys: StoredPasskey[];
  session: Session | null;
  accounts: Accounts;
  accountsLoading: boolean;
  proverStatus: ProverStatus;
  /** Cross-origin isolation enables multi-threaded proving. */
  isolated: boolean;
  warmProver: () => void;
  register: (label: string) => Promise<void>;
  unlock: (passkey?: StoredPasskey) => Promise<void>;
  lock: () => void;
  refreshAccounts: () => Promise<void>;
  refreshPasskeys: () => void;
}

const VeraKeyContext = createContext<VeraKeyContextValue | null>(null);

/** Prover threads: every core up to 8 when cross-origin isolated, otherwise one. */
export function proverThreads(): number {
  return globalThis.crossOriginIsolated === true ? Math.min(navigator.hardwareConcurrency || 4, 8) : 1;
}

function createClient(config: NetworkConfig): VeraKeyClient {
  return new VeraKeyClient({
    rpId: config.rpId,
    rpName: "VeraKey",
    chainId: config.chainId,
    rpcUrl: new URL(config.rpcUrl, location.origin).toString(),
    factory: config.contracts.factory,
    usdg: config.contracts.usdg,
    rpIdHash: config.rpIdHash,
    relayerUrl: "/api",
    relayerFee: BigInt(config.relayer.fee),
    appIds: DEMO_APPS.map(app => app.appId),
    loadProver: async () => {
      // Same-origin CRS (see patches/@aztec__bb.js*.patch): no CDN on the demo path.
      (globalThis as { __BB_CRS_HOST__?: string }).__BB_CRS_HOST__ = `${location.origin}/crs`;
      const { VeraKeyProver } = await import("@verakey/sdk/prover");
      return VeraKeyProver.create({
        threads: proverThreads(),
        srsSize: 2 ** 17,
      });
    },
  });
}

export function VeraKeyProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<NetworkConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [client, setClient] = useState<VeraKeyClient | null>(null);
  const [passkeys, setPasskeys] = useState<StoredPasskey[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [accounts, setAccounts] = useState<Accounts>({});
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [proverStatus, setProverStatus] = useState<ProverStatus>("idle");

  useEffect(() => {
    loadNetworkConfig()
      .then(cfg => {
        const instance = createClient(cfg);
        setConfig(cfg);
        setClient(instance);
        setPasskeys(instance.store.list());
      })
      .catch(error => setConfigError(error instanceof Error ? error.message : String(error)));
  }, []);

  const warmProver = useCallback(() => {
    if (!client || proverStatus === "loading" || proverStatus === "ready") return;
    setProverStatus("loading");
    client
      .prover()
      .then(() => setProverStatus("ready"))
      .catch(() => setProverStatus("error"));
  }, [client, proverStatus]);

  const refreshAccounts = useCallback(async () => {
    if (!client?.session) return;
    setAccountsLoading(true);
    try {
      const entries = await Promise.all(DEMO_APPS.map(async app => [app.key, await client.account(app.appId)] as const));
      setAccounts(Object.fromEntries(entries));
    } finally {
      setAccountsLoading(false);
    }
  }, [client]);

  const refreshPasskeys = useCallback(() => {
    if (client) setPasskeys(client.store.list());
  }, [client]);

  const afterSession = useCallback(
    async (next: Session) => {
      setSession(next);
      setPasskeys(client!.store.list());
      setProverStatus(status => (status === "idle" ? "loading" : status));
      await client!.prover().then(() => setProverStatus("ready"));
      await refreshAccounts();
    },
    [client, refreshAccounts]
  );

  const register = useCallback(
    async (label: string) => {
      if (!client) return;
      const { session: created } = await client.register(label);
      await afterSession(created ?? (await client.unlock()));
    },
    [client, afterSession]
  );

  const unlock = useCallback(
    async (passkey?: StoredPasskey) => {
      if (!client) return;
      await afterSession(await client.unlock(passkey));
    },
    [client, afterSession]
  );

  const lock = useCallback(() => {
    client?.lock();
    setSession(null);
    setAccounts({});
  }, [client]);

  const value = useMemo<VeraKeyContextValue>(
    () => ({
      config, configError, client, passkeys, session, accounts, accountsLoading, proverStatus,
      isolated: globalThis.crossOriginIsolated === true,
      warmProver, register, unlock, lock, refreshAccounts, refreshPasskeys,
    }),
    [config, configError, client, passkeys, session, accounts, accountsLoading, proverStatus, warmProver, register, unlock, lock, refreshAccounts, refreshPasskeys]
  );

  return <VeraKeyContext.Provider value={value}>{children}</VeraKeyContext.Provider>;
}

export function useVeraKey(): VeraKeyContextValue {
  const context = useContext(VeraKeyContext);
  if (!context) throw new Error("useVeraKey must be used inside <VeraKeyProvider>");
  return context;
}
