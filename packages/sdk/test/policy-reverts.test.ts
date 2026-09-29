import { describe, expect, it } from "vitest";
import { VeraKeyClient, VeraKeyError } from "../src/client";
import { RelayerError } from "../src/relayer";

const client = () =>
  new VeraKeyClient({
    rpId: "verakey.xyz",
    chainId: 421614,
    rpcUrl: "http://127.0.0.1:1",
    factory: "0x00000000000000000000000000000000000000aa",
    usdg: "0x00000000000000000000000000000000000000ee",
    rpIdHash: `0x${"11".repeat(32)}`,
    relayerUrl: "/api",
    relayerFee: 20_000n,
    appIds: [],
    loadProver: async () => {
      throw new Error("not needed");
    },
  });

describe("the account's refusals are policy, not relay failures", () => {
  for (const revert of ["ChangeAlreadyPending", "LastOwner", "AlreadyOwner"]) {
    it(`${revert} is reported at the policy stage`, async () => {
      const veraKey = client();
      veraKey.relayer.relay = async () => {
        throw new RelayerError(`Simulation reverted: ${revert}`, 422, revert);
      };
      const refusal = await veraKey
        .applyChange("0x00000000000000000000000000000000000000bb", { account: "0x00000000000000000000000000000000000000bb", changeId: `0x${"22".repeat(32)}`, kind: 1, payload: "0x", eta: 0 })
        .then(() => null, error => error);
      expect(refusal).toBeInstanceOf(VeraKeyError);
      expect(refusal.stage).toBe("policy");
      expect(refusal.revert).toBe(revert);
    });
  }
});
