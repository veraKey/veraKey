import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARBITRUM_SEPOLIA } from "../src/deployments";

const sepolia = JSON.parse(readFileSync(new URL("../../../deployments/sepolia.json", import.meta.url), "utf8"));

describe("ARBITRUM_SEPOLIA", () => {
  it("holds the Arbitrum Sepolia deployment, so a redeploy without an SDK release fails here", () => {
    expect(ARBITRUM_SEPOLIA).toEqual({
      name: "arbitrum-sepolia",
      chainId: sepolia.chainId,
      rpcUrl: sepolia.rpcUrl,
      origin: sepolia.origin,
      rpIdHash: sepolia.rpIdHash,
      factory: sepolia.contracts.factory,
      honkVerifier: sepolia.contracts.honkVerifier,
      usdg: sepolia.contracts.usdg,
    });
  });
  it("cannot be changed at runtime", () => {
    expect(Object.isFrozen(ARBITRUM_SEPOLIA)).toBe(true);
  });
});
