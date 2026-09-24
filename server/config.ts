import { readFileSync } from "node:fs";
import path from "node:path";
import type { Hex } from "viem";
import type { NetworkConfig } from "../shared/api";

const NITRO_DEV_KEY = "0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659";

export interface DeploymentFile {
  network: "local" | "sepolia";
  chainId: number;
  rpcUrl: string;
  rpId: string;
  origin: string;
  rpIdHash: Hex;
  contracts: NetworkConfig["contracts"];
  policy: NetworkConfig["policy"];
  circuitVkHash: Hex;
  configHash: Hex;
}

export interface ServerConfig {
  port: number;
  network: NetworkConfig;
  relayerKey: Hex;
  /** The node the relayer and the /api/rpc proxy talk to. */
  upstreamRpcUrl: string;
  /** Local devnode deployments use a mintable test token. */
  mintableUsdg: boolean;
  dataDir: string;
}

export function loadConfig(root: string): ServerConfig {
  const networkName = (process.env.VERAKEY_NETWORK ?? "local") as "local" | "sepolia";
  const deployment = JSON.parse(
    readFileSync(path.join(root, "deployments", `${networkName}.json`), "utf8")
  ) as DeploymentFile;
  const relayerKey = (networkName === "local" ? NITRO_DEV_KEY : process.env.RELAYER_PRIVATE_KEY) as Hex | undefined;
  if (!relayerKey) throw new Error("RELAYER_PRIVATE_KEY must be set for non-local networks");

  return {
    port: Number(process.env.PORT ?? 3090),
    relayerKey,
    upstreamRpcUrl: process.env.RELAYER_RPC_URL ?? deployment.rpcUrl,
    mintableUsdg: networkName === "local",
    dataDir: process.env.VERAKEY_DATA_DIR ?? path.join(root, "data"),
    network: {
      network: networkName,
      chainId: deployment.chainId,
      chainName: networkName === "sepolia" ? "Arbitrum Sepolia" : "Nitro devnode",
      // Browsers read the chain through the relayer's /api/rpc proxy (see server/index.ts).
      rpcUrl: "/api/rpc",
      explorerUrl: networkName === "sepolia" ? "https://sepolia.arbiscan.io" : null,
      rpId: deployment.rpId,
      origin: deployment.origin,
      rpIdHash: deployment.rpIdHash,
      contracts: deployment.contracts,
      policy: deployment.policy,
      relayer: {
        address: "0x0000000000000000000000000000000000000000",
        fee: process.env.RELAYER_FEE_USDG_UNITS ?? "20000", // 0.02 USDG
        faucetAmount: process.env.FAUCET_USDG_UNITS ?? "5000000", // 5 USDG
      },
      circuitVkHash: deployment.circuitVkHash,
      configHash: deployment.configHash,
    },
  };
}
