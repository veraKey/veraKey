import type { Address, Hex } from "viem";

/** Error returned by a VeraKey relayer; `revert` names the contract error when simulation failed. */
export class RelayerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly revert?: string
  ) {
    super(message);
    this.name = "RelayerError";
  }
}

export type RelayableFunction =
  | "pay"
  | "scheduleChange"
  | "restrict"
  | "applyChange"
  | "cancelChange"
  | "cancelRecovery"
  | "executeRecovery";

/** Thin client for the gasless relayer HTTP API (`server/` in this repo). */
export class RelayerClient {
  constructor(private readonly baseUrl: string) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; revert?: string };
    if (!response.ok) {
      throw new RelayerError(data.error ?? `Relayer returned HTTP ${response.status}`, response.status, data.revert);
    }
    return data as T;
  }

  createAccount(appId: Hex, nullifier: Hex): Promise<{ hash: Hex | null; account: Address }> {
    return this.post("/accounts", { appId, nullifier });
  }

  relay(account: Address, functionName: RelayableFunction, args: readonly unknown[]): Promise<{ hash: Hex }> {
    return this.post("/relay", { account, functionName, args });
  }

  faucet(account: Address): Promise<{ hash: Hex }> {
    return this.post("/faucet", { account });
  }
}
