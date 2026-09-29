import { randomInt } from "node:crypto";
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
import { Mutex, RateLimiter } from "./rate-limit";

const BN254_R = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;
/** Refuse anything that would need more gas than a proof-authorized account call (~1.1M). */
const MAX_GAS = 2_500_000n;
/** Safety actions: never refused by the account's caps, so past the day's cap the account waives their fee. */
const SAFETY_ACTIONS = new Set(["restrict", "cancelChange", "cancelRecovery"]);
/** How long an account stays busy after its transaction was sent, at most (normally until it is in a block). */
const IN_FLIGHT_TIMEOUT_MS = 60_000;

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
  /** Accounts with a relayed transaction not yet in a block: a copy sent meanwhile would only revert at the relayer's cost. */
  private readonly inFlight = new Set<string>();
  /** Safety actions relayed per account and UTC day with their fee waived (the relayer pays their gas unpaid). */
  private readonly unpaidSafetyActions = new RateLimiter(
    Number(process.env.UNPAID_SAFETY_ACTIONS_PER_ACCOUNT_PER_DAY ?? 10),
    24 * 60 * 60_000
  );

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

  /**
   * Throws unless `account` is a VeraKey account created by this deployment's factory: its code must
   * be the EIP-1167 clone of this deployment's implementation (so it cannot be a look-alike contract
   * that burns the relayer's gas), and the clone must have been initialized by this factory.
   */
  private async assertOurAccount(account: Address) {
    const code = await this.publicClient.getCode({ address: account });
    if (!code || code === "0x") throw new RelayError(404, "Account is not deployed.");
    const implementation = this.config.network.contracts.accountImplementation.slice(2).toLowerCase();
    if (code.toLowerCase() !== `0x363d3d373d3d3d363d73${implementation}5af43d82803e903d91602b57fd5bf3`) {
      throw new RelayError(400, "Not a VeraKey account.");
    }
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
      let gas: bigint;
      try {
        gas = await this.publicClient.estimateContractGas({ ...prepared.request, account: this.wallet.account });
      } catch (error) {
        // The state moved since the simulation (e.g. the same action just landed): refuse it like a failed simulation.
        const revert = revertNameOf(error);
        if (revert) throw new RelayError(422, `Simulation reverted: ${revert}`, revert);
        throw new RelayError(502, "The RPC endpoint could not estimate the transaction's gas.");
      }
      if (gas > MAX_GAS) throw new RelayError(422, "Transaction needs too much gas.");
      return this.wallet.writeContract({ ...prepared.request, gas: (gas * 12n) / 10n } as never);
    });
  }

  /** `beforeDeploy` runs only when a new account would be deployed (e.g. to rate-limit that). */
  async createAccount(appId: unknown, nullifier: unknown, beforeDeploy: () => void = () => {}): Promise<{ hash: Hex | null; account: Address }> {
    if (!isFieldHex(appId) || !isFieldHex(nullifier) || BigInt(nullifier) === 0n) {
      throw new RelayError(400, "appId and nullifier must be 32-byte BN254 field elements.");
    }
    const factory = this.config.network.contracts.factory;
    const account = await this.publicClient.readContract({
      address: factory, abi: veraKeyFactoryAbi, functionName: "accountAddress", args: [appId, nullifier],
    });
    const code = await this.publicClient.getCode({ address: account });
    if (code && code !== "0x") return { hash: null, account };
    beforeDeploy();
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
    // Proof-authorized calls sign the USDG fee the account pays the fee recipient (this relayer): never
    // pay gas for less.
    const fee = item.inputs.findIndex(input => input.name === "fee");
    if (fee >= 0 && (args[fee] as bigint) < BigInt(this.config.network.relayer.fee)) {
      throw new RelayError(402, "The signed relayer fee is too low.");
    }
    await this.assertOurAccount(body.account);
    // One transaction per account at a time, until it is in a block: a copy of the same request (or another action
    // for the same nonce) would pass its simulation meanwhile and then revert at the relayer's cost.
    const busy = body.account.toLowerCase();
    if (this.inFlight.has(busy)) {
      throw new RelayError(409, "Another transaction for this account is on its way. Try again in a moment.");
    }
    this.inFlight.add(busy);
    let hash: Hex;
    try {
      if (fee >= 0 && SAFETY_ACTIONS.has(body.functionName)) await this.limitUnpaidSafetyAction(body.account, args[fee] as bigint);
      // Optional random delay before broadcasting (RELAY_JITTER_MAX_MS), so submission times say less about
      // which requests arrived together. Off by default: it adds latency and only helps alongside real
      // traffic or several relayers. It never changes what is submitted.
      const jitter = Number(process.env.RELAY_JITTER_MAX_MS ?? 0);
      if (jitter > 0) await new Promise(resolve => setTimeout(resolve, randomInt(0, jitter)));
      hash = await this.submit({ address: body.account, abi: veraKeyAccountAbi, functionName: body.functionName, args } as never);
    } catch (error) {
      this.inFlight.delete(busy);
      throw error;
    }
    void this.publicClient
      .waitForTransactionReceipt({ hash, timeout: IN_FLIGHT_TIMEOUT_MS })
      .catch(() => undefined)
      .finally(() => this.inFlight.delete(busy));
    return hash;
  }

  /**
   * Past the day's cap an account waives a safety action's fee, so the relayer would pay its gas for nothing. It still
   * relays them, since they are how owners defend an account, but only a few per account and UTC day.
   */
  private async limitUnpaidSafetyAction(account: Address, fee: bigint) {
    const [, dailyCap, spentToday] = (await this.publicClient.readContract({
      address: account, abi: veraKeyAccountAbi, functionName: "policy",
    })) as readonly [bigint, bigint, bigint, bigint, boolean];
    if (spentToday + fee > dailyCap && !this.unpaidSafetyActions.take(account.toLowerCase())) {
      throw new RelayError(
        429,
        "This account has spent today's cap, so it pays no fee for this action, and the relayer has sent today's share of those for it. Submit it yourself, or try again tomorrow."
      );
    }
  }

  /** Sends the demo amount of USDG to a new account, once per account. `beforeGrant` runs only when it will send. */
  async faucet(account: unknown, beforeGrant: () => void = () => {}): Promise<Hex> {
    if (typeof account !== "string" || !isAddress(account)) throw new RelayError(400, "Invalid account.");
    await this.assertOurAccount(account);
    const key = account.toLowerCase();
    if (this.funded.has(key)) throw new RelayError(409, "This account already received demo USDG.");
    // Reserved before the first await, so a concurrent request for the same account gets 409 instead of a second grant.
    this.funded.add(key);
    let hash: Hex;
    try {
      beforeGrant();
      const amount = BigInt(this.config.network.relayer.faucetAmount);
      const usdg = this.config.network.contracts.usdg;
      if (!this.config.mintableUsdg) {
        const treasury = await this.publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [this.address] });
        if (treasury < amount) throw new RelayError(503, "The demo faucet is out of USDG. Try again later.");
      }
      hash = this.config.mintableUsdg
        ? await this.submit({
            address: usdg,
            abi: [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [] }],
            functionName: "mint",
            args: [account, amount],
          } as never)
        : await this.submit({ address: usdg, abi: erc20Abi, functionName: "transfer", args: [account, amount] } as never);
    } catch (error) {
      this.funded.delete(key);
      throw error;
    }
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
