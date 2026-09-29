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

/** How often, and how far apart, `relay` asks again while the account's previous transaction is on its way. */
const BUSY_RETRIES = 10;
const BUSY_RETRY_MS = 1_000;

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

  /**
   * Relays one call. While the relayer is still sending another transaction for the same account it answers 409 and
   * sends nothing, so this waits a moment and asks again, for up to about ten seconds.
   */
  async relay(account: Address, functionName: RelayableFunction, args: readonly unknown[]): Promise<{ hash: Hex }> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.post("/relay", { account, functionName, args });
      } catch (error) {
        if (!(error instanceof RelayerError) || error.status !== 409 || attempt >= BUSY_RETRIES) throw error;
        await new Promise(resolve => setTimeout(resolve, BUSY_RETRY_MS));
      }
    }
  }

  faucet(account: Address): Promise<{ hash: Hex }> {
    return this.post("/faucet", { account });
  }
}
