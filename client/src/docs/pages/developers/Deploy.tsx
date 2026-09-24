import { A, Callout, Code, H2, Table } from "../../components";

export default function DeployPage() {
  return (
    <>
      <H2>Toolchain</H2>
      <p>The versions are pinned; other versions produce different circuits and verifiers.</p>
      <Table
        head={["Tool", "Version"]}
        rows={[
          ["Node and pnpm", "Node 22, pnpm 10"],
          ["Rust", "1.91 with the wasm32-unknown-unknown target"],
          ["cargo-stylus", "0.10.9"],
          ["Foundry", "forge and cast"],
          ["Noir and Barretenberg", "nargo 1.0.0-beta.25 and bb 5.2.0 (the pair Aztec 5.2.0 ships)"],
          ["Docker", "for the local devnode and the production image"],
        ]}
      />

      <H2>Build and test</H2>
      <Code lang="bash">{`
pnpm install
scripts/build-circuit.sh     # both circuits: nargo test + compile, verification keys, Solidity verifiers
pnpm contracts:test          # Rust unit and property tests (contracts/stylus/core)
pnpm contracts:evm:test      # the ERC-7579 validator (Foundry, real proofs)
pnpm test:docs               # the docs site's unit tests
`}</Code>

      <H2>Run a local devnode</H2>
      <Code lang="bash">{`
scripts/devnode.sh up        # a nitro devnode on 127.0.0.1:8649, upgraded to ArbOS 61
scripts/deploy.sh local      # verifiers, validator, a mintable test USDG, the account implementation, factories
pnpm test:e2e                # 61 end-to-end tests with real proofs
pnpm dev                     # relayer on :3090, app on http://localhost:5190
node scripts/browser-e2e.mjs http://localhost:5190 /tmp/verakey-browser desktop   # the app's workflow in Chrome
node scripts/check-docs.mjs http://localhost:5190                                  # every docs page, link and anchor
`}</Code>
      <p>
        The devnode keeps no state: after <code>scripts/devnode.sh down</code> or a reboot, run <code>up</code> and{" "}
        <code>deploy.sh local</code> again. Repeated browser runs need the relayer's per-visitor limits raised, e.g.{" "}
        <code>FAUCET_ACCOUNTS_PER_IP=100 pnpm dev</code>.
      </p>

      <H2>Deploy to Arbitrum Sepolia</H2>
      <ol>
        <li>
          <strong>Choose the app's https domain first.</strong> The factory binds every account to that origin and rpId, so
          a new domain needs a new deployment.
        </li>
        <li>
          <strong>Keys and funding.</strong> Run <code>cp .env.example .env</code>, then set the keys,{" "}
          <code>VERAKEY_ORIGIN</code> and <code>VERAKEY_RP_ID</code>:
          <ul>
            <li>give the relayer its own key, not the deployer's: its key lives on an internet-facing server, and every account pays its fees to its address;</li>
            <li>fund the deployer with at least 0.01 Arbitrum Sepolia ETH;</li>
            <li>fund the relayer with ETH for gas, and with USDG from <A href="https://faucet.paxos.com">faucet.paxos.com</A> for the demo faucet.</li>
          </ul>
        </li>
        <li>
          <strong>Deploy.</strong> <code>scripts/deploy.sh sepolia --check</code> lists whatever is missing without sending a
          transaction. <code>scripts/deploy.sh sepolia</code> then:
          <ul>
            <li>deploys the contracts;</li>
            <li>bids to cache the Stylus programs;</li>
            <li>verifies the Solidity contracts on Sourcify;</li>
            <li>writes <code>deployments/sepolia.json</code>. Commit that file.</li>
          </ul>
        </li>
      </ol>
      <Code lang="bash">{`
scripts/deploy.sh sepolia --check
scripts/deploy.sh sepolia
`}</Code>

      <H2>Serve the app</H2>
      <Code lang="bash">{`
docker build -t verakey .
docker run -d --restart unless-stopped -p 127.0.0.1:3090:3090 \\
  -e VERAKEY_NETWORK=sepolia -e RELAYER_PRIVATE_KEY=0x… -v verakey-data:/data verakey
`}</Code>
      <p>
        Put the container behind exactly one TLS-terminating proxy, such as a hosting provider's router, Caddy, nginx or
        a cloudflared named tunnel routed to <code>http://localhost:3090</code>. Bind the port to loopback, as above: the
        server trusts one proxy hop for the client address. Without Docker, run <code>pnpm build && pnpm start</code>,
        which reads <code>.env</code>.
      </p>
      <Callout kind="note" title="Railway">
        <code>railway.json</code> builds the Dockerfile. Generate the service's domain before deploying the contracts and use
        it as the origin, and set <code>RELAYER_PRIVATE_KEY</code> in the service variables. To keep the faucet's record of
        funded accounts across redeploys, mount a volume at <code>/data</code> and set <code>RAILWAY_RUN_UID=0</code>.
      </Callout>

      <H2>Environment variables</H2>
      <Table
        head={["Variable", "Used by", "Meaning (default)"]}
        rows={[
          [<code key="1">DEPLOYER_PRIVATE_KEY</code>, "deploy.sh", "Deploys the contracts. Keep it off the server."],
          [<code key="2">VERAKEY_ORIGIN, VERAKEY_RP_ID</code>, "deploy.sh", "The app's https origin and its WebAuthn rpId. Bound into every account."],
          [<code key="3">ARBITRUM_SEPOLIA_RPC</code>, "deploy.sh", "An RPC URL, possibly keyed. Never written to deployments/."],
          [<code key="4">VERAKEY_PER_TX_CAP, VERAKEY_DAILY_CAP</code>, "deploy.sh", "Default caps for new accounts (10 and 25 USDG)."],
          [<code key="5">VERAKEY_NEW_PAYEE_CAP</code>, "deploy.sh", "Largest first payment to a new recipient (2 USDG)."],
          [<code key="6">VERAKEY_MAX_FEE, VERAKEY_FEE_RECIPIENT</code>, "deploy.sh", "Largest fee per action (0.25 USDG) and where fees go (the relayer's address)."],
          [<code key="7">VERAKEY_CHANGE_DELAY, VERAKEY_RECOVERY_DELAY</code>, "deploy.sh", "Timelocks in seconds (120 and 300; production defaults 86400 and 259200)."],
          [<code key="8">VERAKEY_CACHE_MAX_BID_WEI</code>, "deploy.sh", "Largest bid to cache a Stylus program (0.001 ETH)."],
          [<code key="9">VERAKEY_NETWORK</code>, "server", "Which deployments/<network>.json to serve (sepolia in the image)."],
          [<code key="10">RELAYER_PRIVATE_KEY</code>, "server", "Signs every relayed transaction."],
          [<code key="11">RELAYER_RPC_URL</code>, "server", "The node for relaying and /api/rpc (the deployment's RPC)."],
          [<code key="12">RELAYER_FEE_USDG_UNITS, FAUCET_USDG_UNITS</code>, "server", "The relayer fee (20000 = 0.02 USDG) and the faucet amount (5000000 = 5 USDG)."],
          [<code key="13">RELAY_JITTER_MAX_MS</code>, "server", "A random delay before each broadcast (0)."],
          [<code key="14">API_REQUESTS_PER_IP_PER_MINUTE, ACCOUNTS_PER_IP_PER_DAY, FAUCET_ACCOUNTS_PER_IP</code>, "server", "Rate limits (30, 10, 3)."],
          [<code key="15">VERAKEY_DATA_DIR, PORT, HOST</code>, "server", "Faucet record directory (./data, /data in the image), port (3090) and bind address."],
        ]}
      />
    </>
  );
}
