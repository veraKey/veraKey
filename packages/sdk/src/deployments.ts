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

/**
 * VeraKey on Arbitrum Sepolia for https://verakey.xyz, deployed 2026-09-27. A redeploy changes these values
 * and ships in a new SDK version.
 */
export const ARBITRUM_SEPOLIA: VeraKeyDeployment = Object.freeze({
  name: "arbitrum-sepolia",
  chainId: 421614,
  rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
  origin: "https://verakey.xyz",
  rpIdHash: "0x57bea8798cb14a63fbde043755cfe53f5f7c3ed90da0d3cbbbbfee14af74c88c",
  factory: "0xbaac250f9f1b07651c121e314bccc6fa4c64e55c",
  honkVerifier: "0x6158Fc3c9F78f78eA780f30ab3E8515AD04Bd834",
  usdg: "0xFFC95faa3d63Cde504a05B567C600B78C0b41892",
});
