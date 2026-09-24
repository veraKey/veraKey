import { describe, expect, it } from "vitest";
import { toFieldHex } from "../src/bytes";
import { BN254_R } from "../src/constants";
import { appIdFromName } from "../src/nullifier";
import {
  SIGN_IN_TYPEHASH,
  accountAddressOf,
  appIdFromOrigin,
  normalizeOrigin,
  signInChallenge,
  type SignInStatement,
} from "../src/signin";

const GAME = "https://game.example";
const statement: SignInStatement = {
  chainId: 421614,
  factory: "0x45bbaf84eea0c285db53fd7d72187e9e3843c3e4",
  origin: GAME,
  appId: "0x1e9cd87f87126b42ff85a42a3d0d866cc041708bfb6fd05cb7b713dff2599af6",
  nullifier: toFieldHex(2n),
  nonce: `0x${"11".repeat(32)}`,
  issuedAt: 1_790_000_000,
  expiresAt: 1_790_000_300,
};

describe("appIdFromOrigin", () => {
  it("derives a field element from the site's origin", () => {
    expect(toFieldHex(appIdFromOrigin(GAME))).toBe(statement.appId);
    expect(appIdFromOrigin("http://localhost:5191")).toBeLessThan(BN254_R);
  });
  it("gives every origin its own id", () => {
    const origins = [GAME, "https://game.example:8443", "http://game.example", "https://play.game.example", "https://other.example"];
    expect(new Set(origins.map(appIdFromOrigin)).size).toBe(origins.length);
  });
  it("never equals the id of one of VeraKey's own apps with the same name", () => {
    expect(appIdFromOrigin(GAME)).not.toBe(appIdFromName(GAME));
  });
  it("normalizes the origin, and refuses anything that is not one", () => {
    expect(appIdFromOrigin("https://Game.Example/")).toBe(appIdFromOrigin(GAME));
    expect(normalizeOrigin("http://localhost:5191/play?level=2#top")).toBe("http://localhost:5191");
    expect(() => appIdFromOrigin("game.example")).toThrow();
    expect(() => appIdFromOrigin("data:text/plain,hi")).toThrow();
  });
});

describe("signInChallenge", () => {
  it("hashes the statement under the sign-in type hash", () => {
    expect(SIGN_IN_TYPEHASH).toBe("0xac886c228cf35779f4d0bfbd47f318dffe6d554d2edd0af8d8d6ff3b872fd52d");
    expect(signInChallenge(statement)).toBe("0x0355bbf61d2a671aca6d892754ab0428a564e8b325cb62cf4af30843a55dbdaa");
  });
  it("changes with every field", () => {
    const variants: Partial<SignInStatement>[] = [
      { chainId: 42161 },
      { factory: "0x0000000000000000000000000000000000000001" },
      { origin: "https://other.example" },
      { appId: toFieldHex(1n) },
      { nullifier: toFieldHex(3n) },
      { nonce: `0x${"22".repeat(32)}` },
      { issuedAt: 1_790_000_001 },
      { expiresAt: 1_790_000_301 },
    ];
    const challenges = variants.map(variant => signInChallenge({ ...statement, ...variant }));
    expect(new Set([signInChallenge(statement), ...challenges]).size).toBe(variants.length + 1);
  });
});

describe("accountAddressOf", () => {
  it("matches the factory on Arbitrum Sepolia", () => {
    // factory.accountAddress(1, 2), read from the Sepolia deployment on 2026-09-24
    const deployment = {
      factory: "0x45bbaf84eea0c285db53fd7d72187e9e3843c3e4",
      accountImplementation: "0x72bb20016847e06c1eba897c7dc504abff164c50",
      configHash: "0x9d584d65853c7a2c6809929eec24071376caba939270ac8de2d7bb4c3e057183",
    } as const;
    expect(accountAddressOf(deployment, 1n, 2n)).toBe("0xF54d3d9a835a4bB87594f55B21a4789b51B2F8F2");
  });
});
