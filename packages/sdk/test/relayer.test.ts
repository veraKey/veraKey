import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { RelayerClient, RelayerError } from "../src/relayer";

const ACCOUNT: Address = "0x00000000000000000000000000000000000000aa";

/** A relayer that answers each POST with the next status in `statuses`. */
function relayerAnswering(statuses: number[]) {
  const fetch = vi.fn(async () => {
    const status = statuses.shift() ?? 500;
    const body = status === 200 ? { hash: "0x1234" } : { error: status === 409 ? "Another transaction for this account is on its way." : "no" };
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RelayerClient.relay", () => {
  it("waits out another transaction for the same account (409), then sends again", async () => {
    const fetch = relayerAnswering([409, 409, 200]);
    const relayed = new RelayerClient("http://relayer/api").relay(ACCOUNT, "pay", []);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(relayed).resolves.toEqual({ hash: "0x1234" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("gives up with the relayer's 409 when the account stays busy", async () => {
    relayerAnswering(Array(40).fill(409));
    const relayed = new RelayerClient("http://relayer/api").relay(ACCOUNT, "pay", []);
    const outcome = relayed.then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(RelayerError);
    expect((error as RelayerError).status).toBe(409);
  });

  it("does not repeat a request the relayer refused for another reason", async () => {
    const fetch = relayerAnswering([422]);
    await expect(new RelayerClient("http://relayer/api").relay(ACCOUNT, "pay", [])).rejects.toMatchObject({ status: 422 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
