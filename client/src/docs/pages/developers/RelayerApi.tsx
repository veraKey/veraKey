import { A, Callout, Code, H2, Table } from "../../components";

export default function RelayerApiPage() {
  return (
    <>
      <H2>Overview</H2>
      <p>
        The VeraKey relayer serves the app and a JSON API under <code>/api</code>. It never sees a passkey, a
        signature or a PRF secret: it receives finished proofs and public call data, simulates them, and submits only what
        would succeed. It pays the gas; accounts pay it back in USDG.
      </p>
      <Table
        head={["Endpoint", "Purpose"]}
        rows={[
          [<code key="1">GET /api/config</code>, "The deployment and relayer settings the SDK needs"],
          [<code key="2">GET /api/health</code>, "The relayer's address and balances"],
          [<code key="3">POST /api/accounts</code>, "Deploy an account (idempotent)"],
          [<code key="4">POST /api/relay</code>, "Submit a proof-authorized account call"],
          [<code key="5">POST /api/faucet</code>, "Demo USDG for a new account (testnets)"],
          [<code key="6">POST /api/rpc</code>, "A read-only JSON-RPC proxy"],
        ]}
      />
      <p>Requests and responses are JSON. Big integers travel as decimal strings.</p>

      <H2>GET /api/config</H2>
      <p>The live response on Arbitrum Sepolia:</p>
      <Code lang="json">{`
{
  "network": "sepolia",
  "chainId": 421614,
  "chainName": "Arbitrum Sepolia",
  "rpcUrl": "/api/rpc",
  "explorerUrl": "https://sepolia.arbiscan.io",
  "rpId": "verakey.xyz",
  "origin": "https://verakey.xyz",
  "rpIdHash": "0x57bea8798cb14a63fbde043755cfe53f5f7c3ed90da0d3cbbbbfee14af74c88c",
  "contracts": {
    "honkVerifier": "0x6158Fc3c9F78f78eA780f30ab3E8515AD04Bd834",
    "linkVerifier": "0x8d5CF3023DA9a9257D680eb1bF3832df10CCe291",
    "veraKeyValidator": "0x42aEc9C527280e8E3E3B90135FA7C007274b4fdE",
    "accountImplementation": "0xfb14e3accc7a1296ecb2b6003f935566fbd5f8c6",
    "factory": "0x3b570f82108f16bb9e59b409b618d6cb422757b7",
    "factoryAlt": "",
    "usdg": "0xFFC95faa3d63Cde504a05B567C600B78C0b41892"
  },
  "policy": {
    "perTxCap": "10000000", "dailyCap": "25000000", "newPayeeCap": "2000000",
    "maxFee": "250000", "feeRecipient": "0x6D377a3927df664FDA9946Aa0E6fb8F707844fA8",
    "changeDelay": 120, "recoveryDelay": 300
  },
  "relayer": { "address": "0x6D377a3927df664FDA9946Aa0E6fb8F707844fA8", "fee": "20000", "faucetAmount": "5000000" },
  "circuitVkHash": "0x16378935c4dee31e952a8c42d2f20d4d5dbd00ee2e8225a1eb16e908caf37f12",
  "configHash": "0xda38b760b0e8178c9a64cff2e28e76f150b3c751c4b22430cbac80b7fd15677e"
}
`}</Code>
      <p>
        Amounts are USDG base units (6 decimals) and delays are seconds. <code>relayer.fee</code> is the fee to sign into
        every action.
      </p>

      <H2>GET /api/health</H2>
      <Code lang="json">{`
{ "relayer": "0x6D377a3927df664FDA9946Aa0E6fb8F707844fA8", "eth": "12000000000000000", "usdg": "0", "block": "312092461" }
`}</Code>
      <p><code>eth</code> is in wei and <code>usdg</code> in base units: the relayer's gas budget and the faucet's treasury.</p>

      <H2>POST /api/accounts</H2>
      <Code lang="json" title="Request">{`
{ "appId": "0x…32 bytes", "nullifier": "0x…32 bytes" }
`}</Code>
      <Code lang="json" title="Response">{`
{ "hash": "0x… or null when the account already exists", "account": "0x…" }
`}</Code>
      <p>
        Both values must be 32-byte BN254 field elements, and the nullifier cannot be zero. It is idempotent: an existing
        account returns <code>hash: null</code>. The SDK calls it through <code>ensureAccount</code>.
      </p>

      <H2>POST /api/relay</H2>
      <Code lang="json" title="Request">{`
{
  "account": "0x…",
  "functionName": "pay",
  "args": ["0xRecipient…", "2000000", "20000", "1790000000", "0xNullifier…", "0xClientDataJSON…", "0xProof…"]
}
`}</Code>
      <Code lang="json" title="Response">{`
{ "hash": "0x…transaction hash" }
`}</Code>
      <p>
        <code>functionName</code> is one of <code>pay</code>, <code>scheduleChange</code>, <code>restrict</code>,{" "}
        <code>applyChange</code>, <code>cancelChange</code>, <code>cancelRecovery</code> and <code>executeRecovery</code>. The
        relayer checks, in order, that:
      </p>
      <ol>
        <li>the arguments match the function's ABI, and each <code>bytes</code> argument is at most 16 KiB;</li>
        <li>the signed fee is at least the relayer's fee (else 402);</li>
        <li>the account's code is the EIP-1167 clone of this deployment's implementation, and the account belongs to this factory;</li>
        <li>no other transaction for the account is still on its way (else 409): one at a time, until it is in a block;</li>
        <li>
          for <code>restrict</code>, <code>cancelChange</code> and <code>cancelRecovery</code> whose fee would go past the
          account's daily cap, so the account waives all or part of it, that the account has not used its 10 such relays
          today (else 429);
        </li>
        <li>the call succeeds in simulation, and again when its gas is estimated (else 422 with the contract error's name);</li>
        <li>it needs at most 2.5 million gas.</li>
      </ol>
      <p>
        Nothing that fails a check is ever broadcast. An optional random delay can separate arrival and
        submission times.
      </p>

      <H2>POST /api/faucet</H2>
      <Code lang="json" title="Request">{`
{ "account": "0x…" }
`}</Code>
      <p>
        Sends the demo amount (5 USDG) to a deployed VeraKey account of this deployment, once per account, even to
        concurrent requests. Responds <code>{"{ \"hash\": \"0x…\" }"}</code>, 409 if the account was already funded, 429
        when the visitor or the faucet has reached today's limit, or 503 when the treasury is empty.
      </p>

      <H2>POST /api/rpc</H2>
      <p>
        A JSON-RPC 2.0 proxy for reads, so browsers never need the RPC provider's URL or key. It accepts one request or a
        batch of up to 10, counted as that many requests, and only these methods:
      </p>
      <Code lang="text">{`
eth_chainId eth_blockNumber eth_call eth_getCode eth_getBalance eth_getBlockByNumber eth_getTransactionByHash
eth_getTransactionReceipt eth_getTransactionCount eth_estimateGas eth_gasPrice eth_maxPriorityFeePerGas
eth_feeHistory eth_getLogs net_version
`}</Code>
      <p>
        <code>eth_getLogs</code> must name the contracts it reads (<code>address</code>, at most 10) and either a block
        hash or a range of at most 100,000 blocks whose ends are block numbers, not tags such as <code>latest</code>. Any
        other method, or an unbounded log query, gets{" "}
        <code>{"{ \"error\": { \"code\": -32601, \"message\": \"Method not allowed\" } }"}</code> with status 400.
      </p>

      <H2>Errors</H2>
      <p>Errors are <code>{"{ \"error\": string, \"revert\"?: string }"}</code>:</p>
      <Table
        head={["Status", "When"]}
        rows={[
          ["400", "A malformed request; arguments that do not match the ABI; not a VeraKey account; an account of another deployment"],
          ["402", "The signed relayer fee is too low"],
          ["404", "The account is not deployed"],
          ["409", "The faucet already funded this account; another transaction for this account is still on its way"],
          ["413", "A bytes argument is larger than 16 KiB"],
          ["422", "The call reverts in simulation or gas estimation (revert holds the contract error, e.g. PerTxCapExceeded), or needs too much gas"],
          ["429", "A rate limit or a daily budget was reached"],
          ["500", "An unexpected relayer error"],
          ["502", "The RPC endpoint could not simulate or estimate the call, or is unavailable"],
          ["503", "The demo faucet is out of USDG"],
        ]}
      />
      <p>The SDK maps these to <A href="/docs/build/sdk#errors">error stages</A>.</p>

      <H2>Rate limits</H2>
      <Table
        head={["Limit", "Value"]}
        rows={[
          ["API requests per visitor (not /api/rpc)", "30 per minute"],
          ["RPC calls per visitor (each call of a batch counts)", "900 per minute"],
          ["Requests per account (relay) or nullifier (accounts)", "12 per minute"],
          ["New accounts per visitor", "10 per day"],
          ["New accounts for everyone", "500 per day"],
          ["Faucet requests per visitor", "3 per day"],
          ["Faucet grants for everyone", "20 per day"],
          ["Fee-free safety actions per account", "10 per day"],
        ]}
      />
      <p>
        A visitor is one IPv4 address, or one IPv6 /64: a machine usually holds a whole /64, so rotating addresses inside
        it does not reset its limits. The daily budgets for everyone keep any number of visitors from emptying the
        relayer's gas or the faucet.
      </p>
      <Callout kind="security" title="No raw IP addresses">
        A visitor is an HMAC-SHA256 of its address under a random secret that rotates every UTC day, kept in memory only.
      </Callout>
    </>
  );
}
