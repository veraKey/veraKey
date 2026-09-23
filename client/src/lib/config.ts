import type { NetworkConfig } from "@shared/api";

let pending: Promise<NetworkConfig> | null = null;

/** The deployment the relayer serves (chain, contracts, rpId, fee). */
export function loadNetworkConfig(): Promise<NetworkConfig> {
  pending ??= fetch("/api/config").then(async response => {
    if (!response.ok) throw new Error(`Relayer unavailable (HTTP ${response.status})`);
    return (await response.json()) as NetworkConfig;
  });
  return pending;
}

export function explorerTx(config: Pick<NetworkConfig, "explorerUrl">, hash: string): string | null {
  return config.explorerUrl ? `${config.explorerUrl}/tx/${hash}` : null;
}

export function explorerAddress(config: NetworkConfig, address: string): string | null {
  return config.explorerUrl ? `${config.explorerUrl}/address/${address}` : null;
}
