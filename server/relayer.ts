import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  getAbiItem,
  http,
  isAddress,
  isHex,
  nonceManager,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi, veraKeyAccountAbi, veraKeyFactoryAbi } from "../packages/sdk/src/abi";
import { RELAYABLE_FUNCTIONS, type RelayRequest } from "../shared/api";
import type { ServerConfig } from "./config";
import { Mutex } from "./rate-limit";

const BN254_R = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;
/** Refuse anything that would need more gas than a proof-authorized account call. */
const MAX_GAS = 12_000_000n;

export class RelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly revert?: string
  ) {
    super(message);
  }
}

function revertNameOf(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const revert = error.walk(e => e instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError ? (revert.data?.errorName ?? "Reverted") : undefined;
}

function isFieldHex(value: unknown): value is Hex {
  return typeof value === "string" && isHex(value) && value.length === 66 && BigInt(value) < BN254_R;
}

export class Relayer {
  readonly chain;
  readonly publicClient;
  readonly wallet;
  readonly address: Address;
  private readonly sendLock = new Mutex();
  private readonly faucetFile: string;
  private readonly funded: Set<string>;

  constructor(private readonly config: ServerConfig) {
    const net = config.network;
    this.chain = defineChain({
      id: net.chainId,
      name: net.chainName,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [config.upstreamRpcUrl] } },
    });
    const account = privateKeyToAccount(config.relayerKey, { nonceManager });
    this.address = account.address;
    this.publicClient = createPublicClient({ chain: this.chain, transport: http(undefined, { timeout: 20_000, retryCount: 2 }) });
    this.wallet = createWalletClient({ chain: this.chain, account, transport: http(undefined, { timeout: 20_000, retryCount: 2 }) });

    mkdirSync(config.dataDir, { recursive: true });
    this.faucetFile = path.join(config.dataDir, `faucet-${net.network}.json`);
    let funded: string[] = [];
    try {
      funded = JSON.parse(readFileSync(this.faucetFile, "utf8"));
    } catch {
      // First run.
    }
    this.funded = new Set(funded.map(a => a.toLowerCase()));
  }

  /** Throws unless `account` is a VeraKey account created by this deployment's factory. */
  private async assertOurAccount(account: Address) {
    const code = await this.publicClient.getCode({ address: account });
    if (!code || code === "0x") throw new RelayError(404, "Account is not deployed.");
    let factory: Address;
    try {
      [factory] = await this.publicClient.readContract({ address: account, abi: veraKeyAccountAbi, functionName: "config" });
    } catch {
      throw new RelayError(400, "Not a VeraKey account.");
    }
    if (factory.toLowerCase() !== this.config.network.contracts.factory.toLowerCase()) {
      throw new RelayError(400, "Account belongs to a different VeraKey deployment.");
    }
  }

  /** Simulates, then broadcasts. Nothing that fails simulation is ever sent. */
  private async submit(request: Parameters<typeof this.publicClient.simulateContract>[0]): Promise<Hex> {
    let prepared;
    try {
      prepared = await this.publicClient.simulateContract({ ...request, account: this.wallet.account });
    } catch (error) {
      const revert = revertNameOf(error);
      if (revert) throw new RelayError(422, `Simulation reverted: ${revert}`, revert);
      throw new RelayError(502, "The RPC endpoint could not simulate the transaction.");
    }
    return this.sendLock.run(async () => {
      const gas = await this.publicClient.estimateContractGas({ ...prepared.request, account: this.wallet.account });
      if (gas > MAX_GAS) throw new RelayError(422, "Transaction needs too much gas.");
      return this.wallet.writeContract({ ...prepared.request, gas: (gas * 12n) / 10n } as never);
    });
  }

  async createAccount(appId: unknown, nullifier: unknown): Promise<{ hash: Hex | null; account: Address }> {
    if (!isFieldHex(appId) || !isFieldHex(nullifier) || BigInt(nullifier) === 0n) {
      throw new RelayError(400, "appId and nullifier must be 32-byte BN254 field elements.");
    }
    const factory = this.config.network.contracts.factory;
    const account = await this.publicClient.readContract({
      address: factory, abi: veraKeyFactoryAbi, functionName: "accountAddress", args: [appId, nullifier],
    });
    const code = await this.publicClient.getCode({ address: account });
    if (code && code !== "0x") return { hash: null, account };
    const hash = await this.submit({
      address: factory, abi: veraKeyFactoryAbi, functionName: "createAccount", args: [appId, nullifier],
    } as never);
    return { hash, account };
  }

  async relay(body: RelayRequest): Promise<Hex> {
    if (!body || !isAddress(body.account) || !RELAYABLE_FUNCTIONS.includes(body.functionName)) {
      throw new RelayError(400, "Unsupported relay request.");
    }
    const item = getAbiItem({ abi: veraKeyAccountAbi, name: body.functionName }) as
      | { type: string; inputs: readonly { name: string; type: string }[] }
      | undefined;
    if (!item || item.type !== "function" || !Array.isArray(body.args) || body.args.length !== item.inputs.length) {
      throw new RelayError(400, "Arguments do not match the function.");
    }
    const args = item.inputs.map((input, i) => {
      const value = body.args[i];
      if (input.type.startsWith("uint")) {
        if (typeof value !== "string" && typeof value !== "number") throw new RelayError(400, `Bad ${input.name}.`);
        return BigInt(value);
      }
      if (input.type === "bool") return Boolean(value);
      if (typeof value !== "string" || !isHex(value)) throw new RelayError(400, `Bad ${input.name}.`);
      if (input.type === "bytes" && value.length > 2 * 16_384 + 2) throw new RelayError(413, `${input.name} is too large.`);
      return value;
    });
    // Proof-authorized calls sign the USDG fee the account pays the submitter: never pay gas for less.
    const fee = item.inputs.findIndex(input => input.name === "fee");
    if (fee >= 0 && (args[fee] as bigint) < BigInt(this.config.network.relayer.fee)) {
      throw new RelayError(402, "The signed relayer fee is too low.");
    }
    await this.assertOurAccount(body.account);
    return this.submit({ address: body.account, abi: veraKeyAccountAbi, functionName: body.functionName, args } as never);
  }

  /** Sends the demo amount of USDG to a new account, once per account. */
  async faucet(account: unknown): Promise<Hex> {
    if (typeof account !== "string" || !isAddress(account)) throw new RelayError(400, "Invalid account.");
    await this.assertOurAccount(account);
    if (this.funded.has(account.toLowerCase())) throw new RelayError(409, "This account already received demo USDG.");
    const amount = BigInt(this.config.network.relayer.faucetAmount);
    const usdg = this.config.network.contracts.usdg;
    const hash = this.config.mintableUsdg
      ? await this.submit({
          address: usdg,
          abi: [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [] }],
          functionName: "mint",
          args: [account, amount],
        } as never)
      : await this.submit({ address: usdg, abi: erc20Abi, functionName: "transfer", args: [account, amount] } as never);
    this.funded.add(account.toLowerCase());
    writeFileSync(this.faucetFile, JSON.stringify([...this.funded], null, 1));
    return hash;
  }

  async health() {
    const [eth, usdg, block] = await Promise.all([
      this.publicClient.getBalance({ address: this.address }),
      this.publicClient.readContract({
        address: this.config.network.contracts.usdg, abi: erc20Abi, functionName: "balanceOf", args: [this.address],
      }),
      this.publicClient.getBlockNumber(),
    ]);
    return { relayer: this.address, eth: eth.toString(), usdg: usdg.toString(), block: block.toString() };
  }
}
