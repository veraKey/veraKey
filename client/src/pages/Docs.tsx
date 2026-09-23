import { useVeraKey } from "@/state/VeraKeyProvider";
import { explorerAddress } from "@/lib/config";
import { AppLayout } from "./app/AppLayout";
import { Kicker } from "./app/components";

const QUICKSTART = `import { VeraKeyClient } from "@verakey/sdk/client";
import { appIdFromName } from "@verakey/sdk/nullifier";

const APP_ID = appIdFromName("my-app");

const vera = new VeraKeyClient({
  rpId, chainId, rpcUrl, factory, usdg, rpIdHash,   // from GET /api/config
  relayerUrl: "/api",
  relayerFee: 20_000n,                              // 0.02 USDG, signed into every action
  appIds: [APP_ID],
  loadProver: async () =>
    (await import("@verakey/sdk/prover")).VeraKeyProver.create({ srsSize: 2 ** 17 }),
});

await vera.register("Alice");          // passkey + PRF, no seed phrase
const account = await vera.account(APP_ID);

await vera.pay(APP_ID, merchant, 2_000_000n, state => {
  // idle → authenticating → proving → relaying → confirming → verified | rejected
  render(state);
});`;

const THREAT_MODEL: [string, string, string, string][] = [
  ["Passkey public key, signature, authenticator data", "hidden", "hidden", "seen in-browser only"],
  ["PRF secret (never stored)", "hidden", "hidden", "seen in-browser only"],
  ["Which accounts belong to one person", "hidden", "not hidden if it relays for several (IP, timing)", "not hidden"],
  ["Account address and history", "public", "public", "public"],
  ["USDG amounts, recipients, fees, timing", "public", "public", "public"],
  ["appId, rpIdHash, origin (clientDataJSON)", "public: “a VeraKey account for app X”", "public", "public"],
  ["Shared funding source, reused guardian", "public: links accounts", "public", "public"],
];

export function Docs() {
  const { config } = useVeraKey();
  const contracts = config
    ? ([
        ["VeraKeyFactory (Stylus)", config.contracts.factory],
        ["VeraKeyAccount implementation (Stylus)", config.contracts.accountImplementation],
        ["HonkVerifier (Solidity, bb-generated)", config.contracts.honkVerifier],
        ["USDG (Paxos Global Dollar)", config.contracts.usdg],
      ] as const)
    : [];

  return (
    <AppLayout requiresSession={false}>
      <article className="vk-doc">
        <Kicker>Developer docs</Kicker>
        <h1 className="vk-title">Hide-My-Email<br /><em>for wallets.</em></h1>
        <p className="vk-lede">
          VeraKey gives every app its own smart account behind one passkey. Each action is a zero-knowledge
          proof that the passkey signed exactly that action; the chain never receives the passkey's public
          key or signature, so no key material links a user's accounts. Contracts are unaudited: treat this
          as a testnet preview.
        </p>

        <h2>Quickstart</h2>
        <pre><code>{QUICKSTART}</code></pre>

        <h2>How an action is authorized</h2>
        <ol>
          <li><b>Challenge.</b> The action (chain, account, nonce, recipient, amount, fee, deadline ≤10 min) is hashed; the hash is the WebAuthn challenge.</li>
          <li><b>Passkey.</b> The authenticator signs it after Face ID / Touch ID / PIN. Signing assertions request no extensions, so authenticator data stays 37 bytes.</li>
          <li><b>Proof.</b> In the browser, a Noir circuit (UltraHonk, 81,605 gates) proves: a valid P-256 signature over the WebAuthn message, the rpId hash, UP+UV flags, and <code>nullifier = Poseidon2(domain, pk, prfSecret, appId)</code>.</li>
          <li><b>Account.</b> The Stylus account parses <code>clientDataJSON</code> (type, base64url challenge, origin), hashes it, calls the verifier with six public inputs, consumes the nonce, applies the USDG policy and pays.</li>
        </ol>

        <h2>Threat model</h2>
        <table className="vk-matrix">
          <thead><tr><th>Data</th><th>Chain & other apps</th><th>Relayer</th><th>VeraKey page code</th></tr></thead>
          <tbody>
            {THREAT_MODEL.map(([data, chain, relayer, origin]) => (
              <tr key={data}><td>{data}</td><td>{chain}</td><td>{relayer}</td><td>{origin}</td></tr>
            ))}
          </tbody>
        </table>
        <p>
          Every app uses VeraKey's rpId; that is what lets one enrollment serve many apps, and it means the
          page code on the VeraKey origin is trusted. Mitigations: proving only in the browser, no third-party
          scripts (strict CSP), open-source client, and on-chain caps plus timelocks that bound what any valid
          proof can spend. Not claimed: payment privacy or Sybil resistance.
        </p>

        <h2>Why ZK instead of the P-256 precompile?</h2>
        <p>
          One passkey per app, checked by the <code>0x100</code> P256VERIFY precompile for 3,450 gas, also
          gives unlinkable accounts. ZK adds three things: one enrollment for any number of apps, accounts that
          are derived rather than registered, and no public key on-chain to match later. The price is gas: see
          below.
        </p>

        <h2>Gas (measured)</h2>
        <table className="vk-matrix">
          <thead><tr><th>Operation</th><th>Gas</th><th>Where</th></tr></thead>
          <tbody>
            <tr><td>HonkVerifier.verify, called by the account</td><td className="vk-mono">3,781,398</td><td>nitro devnode, ArbOS 61 (466 modexp inversions ≈ 1.88M)</td></tr>
            <tr><td>Account pay (proof + policy + 2 USDG transfers)</td><td className="vk-mono">4,171,302</td><td>nitro devnode, ArbOS 61</td></tr>
            <tr><td>Account logic alone (Stylus: parsing, nonce, policy, transfers)</td><td className="vk-mono">~217,000</td><td>from the call trace</td></tr>
            <tr><td>Factory createAccount (EIP-1167 clone + init)</td><td className="vk-mono">80,812</td><td>local nitro devnode, ArbOS 61</td></tr>
            <tr><td>P256VERIFY precompile (non-ZK baseline)</td><td className="vk-mono">3,450</td><td>RIP-7212</td></tr>
          </tbody>
        </table>

        <h2>Contracts{config ? ` · ${config.chainName} (${config.chainId})` : ""}</h2>
        <table className="vk-matrix">
          <tbody>
            {contracts.map(([name, address]) => {
              const href = config ? explorerAddress(config, address) : null;
              return (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="vk-mono">{href ? <a href={href} target="_blank" rel="noreferrer" style={{ color: "var(--vk-teal)" }}>{address}</a> : address}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2>Supported passkeys</h2>
        <ul>
          <li>iCloud Keychain on macOS 15.4+ / iOS 18.4+ (Safari or Chrome): PRF values are consistent across Apple devices from these versions.</li>
          <li>Google Password Manager in Chrome.</li>
          <li>Any authenticator must support the WebAuthn PRF extension; VeraKey refuses to create accounts without it, because PRF is what keeps accounts unlinkable.</li>
        </ul>
      </article>
    </AppLayout>
  );
}
