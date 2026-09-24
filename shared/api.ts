// Types shared by the relayer API (server/) and the web app (client/).

export interface NetworkConfig {
  network: "local" | "sepolia";
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string | null;
  rpId: string;
  origin: string;
  rpIdHash: `0x${string}`;
  contracts: {
    factory: `0x${string}`;
    accountImplementation: `0x${string}`;
    honkVerifier: `0x${string}`;
    /** Verifier of the consent-to-link circuit (disclosures). */
    linkVerifier?: `0x${string}`;
    /** ERC-7579 validator module: VeraKey proofs for Kernel / Nexus smart accounts. */
    veraKeyValidator?: `0x${string}`;
    usdg: `0x${string}`;
  };
  policy: { perTxCap: string; dailyCap: string; newPayeeCap: string; changeDelay: number; recoveryDelay: number };
  relayer: {
    address: `0x${string}`;
    /** Fee the relayer expects, in USDG base units (6 decimals); it is signed into every action. */
    fee: string;
    faucetAmount: string;
  };
  circuitVkHash: `0x${string}`;
}

/** Account functions the relayer is willing to submit. */
export const RELAYABLE_FUNCTIONS = [
  "pay",
  "scheduleChange",
  "restrict",
  "applyChange",
  "cancelChange",
  "cancelRecovery",
  "executeRecovery",
] as const;
export type RelayableFunction = (typeof RELAYABLE_FUNCTIONS)[number];

export interface RelayRequest {
  account: `0x${string}`;
  functionName: RelayableFunction;
  /** ABI arguments; bigints are sent as decimal strings. */
  args: (string | number | boolean)[];
}

export interface CreateAccountRequest {
  appId: `0x${string}`;
  nullifier: `0x${string}`;
}

export interface TxResponse {
  hash: `0x${string}`;
  account?: `0x${string}`;
}

export interface ApiError {
  error: string;
  /** Custom error name when a simulation reverted, e.g. "PerTxCapExceeded". */
  revert?: string;
}
