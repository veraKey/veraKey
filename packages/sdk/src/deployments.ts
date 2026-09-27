import type { Address } from "viem";
import type { SignInDeployment } from "./signin";

/**
 * A VeraKey deployment a site trusts: its chain, contracts and VeraKey's origin. A site pins it in its own
 * configuration; it never reads one from a request, nor from VeraKey's server at runtime.
 */
export interface VeraKeyDeployment extends SignInDeployment {
  /** A short name, e.g. "arbitrum-sepolia". */
  name: string;
  /** A public RPC endpoint for the chain; production sites pass their own. */
  rpcUrl: string;
  /** USDG, the token accounts hold and pay. */
  usdg: Address;
}

/** VeraKey on Arbitrum Sepolia, deployed 2026-09-24. A redeploy changes these values and ships in a new SDK version. */
export const ARBITRUM_SEPOLIA: VeraKeyDeployment = Object.freeze({
  name: "arbitrum-sepolia",
  chainId: 421614,
  rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
  origin: "https://verakey.mdloglabs.org",
  rpIdHash: "0x0fe14846fe0610bfa7471c5396156cdf8b0c6594cc04194ffadcf8e8a490f4e1",
  factory: "0x6a1505b412e934f6f57f6b8eedcd68c7c8acb276",
  honkVerifier: "0x9BF57a65Cb388132982D3061C9b2d5Ec3bA2df06",
  usdg: "0xFFC95faa3d63Cde504a05B567C600B78C0b41892",
});
