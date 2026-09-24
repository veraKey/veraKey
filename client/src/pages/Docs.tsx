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

const PROTECTIONS = `import { changePayload } from "@verakey/sdk/action";

await vera.freeze(APP_ID, render);                                       // one approval, instant
await vera.restrict(APP_ID, changePayload.setLimits(5_000_000n, 10_000_000n), render); // lower caps now
await vera.scheduleChange(APP_ID, changePayload.unfreeze(), render);     // waits out the change delay

// The browser's payment sheet shows payee and total; the account checks both.
const secureConfirmation = await vera.canConfirmPayments();
await vera.pay(APP_ID, merchant, 2_000_000n, render, { secureConfirmation });

// Only a salted commitment to the guardian goes on-chain.
const card = await vera.guardianCard(APP_ID, guardian);                 // give this to the guardian
await vera.scheduleChange(APP_ID, changePayload.setGuardian(card.commitment), render);`;

const DISCLOSURE = `import { verifyDisclosure } from "@verakey/sdk/disclosure";

// The owner: one passkey approval over a statement naming both apps, the audience and an expiry.
const pkg = await vera.createDisclosure({
  appIdA: PAY_APP_ID, appIdB: SHOP_APP_ID,
  audience: "compliance@exchange.example", nonce: theirNonce, ttlSeconds: 86_400,
});

// The audience: no passkey needed.
const verdict = await verifyDisclosure(pkg, {
  publicClient, chainId, factory, rpIdHash, origin,
  audience: "compliance@exchange.example",      // who is verifying: a forwarded disclosure fails
  nonce: theirNonce,                            // optional: the nonce they asked for
  linkVerifier,                                 // LinkHonkVerifier, checked with eth_call
});
verdict.valid;                                  // plus one entry per check in verdict.checks`;

const VALIDATOR = `import { validatorInstallData, validatorSignature, VALIDATOR_VERIFICATION_GAS } from "@verakey/sdk/validator";

// Install on a Kernel or Nexus account (module type 1, validator).
const initData = validatorInstallData(appIdHex, nullifierHex);

// Sign a user operation: prove a passkey assertion whose challenge is the userOpHash.
userOp.signature = validatorSignature(proof, clientDataJSON);
userOp.verificationGasLimit = VALIDATOR_VERIFICATION_GAS + accountOverhead;  // bundler estimates are too low`;

const THREAT_MODEL: [string, string, string, string][] = [
  ["Passkey public key, signature, authenticator data", "hidden", "hidden", "seen in-browser only"],
  ["PRF secret (never stored)", "hidden", "hidden", "seen in-browser only"],
  ["Which accounts belong to one person", "hidden", "not hidden if it relays for several (IP, timing)", "not hidden"],
  ["Account address and history", "public", "public", "public"],
  ["USDG amounts, recipients, fees, timing", "public", "public", "public"],
  ["appId, rpIdHash, origin (clientDataJSON)", "public: “a VeraKey account for app X”", "public", "public"],
  ["Guardian address", "hidden until it acts (salted commitment)", "hidden until it acts", "seen when set"],
  ["Shared funding source", "public: links accounts", "public", "public"],
  ["A disclosure you make", "only to whoever you give it", "not involved", "seen when made"],
];

export function Docs() {
  const { config } = useVeraKey();
  const contracts = config
    ? ([
        ["VeraKeyFactory (Stylus)", config.contracts.factory],
        ["VeraKeyAccount implementation (Stylus)", config.contracts.accountImplementation],
        ["HonkVerifier (Solidity, bb-generated)", config.contracts.honkVerifier],
        ["LinkHonkVerifier (Solidity, bb-generated)", config.contracts.linkVerifier],
        ["VeraKeyValidator (ERC-7579)", config.contracts.veraKeyValidator],
        ["USDG (Paxos Global Dollar)", config.contracts.usdg],
      ].filter((row): row is [string, string] => Boolean(row[1])))
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
          <li><b>Proof.</b> In the browser, a Noir circuit (UltraHonk, 56,528 gates) proves: a valid P-256 signature over the WebAuthn message, the rpId hash, UP+UV flags, and <code>nullifier = Poseidon2(domain, pk, prfSecret, appId)</code>.</li>
          <li><b>Account.</b> The Stylus account parses <code>clientDataJSON</code> (type, base64url challenge, origin), hashes it, calls the verifier with six public inputs, consumes the nonce, applies the USDG policy and pays.</li>
        </ol>

        <h2>Protections</h2>
        <p>
          A proof shows that an owner approved; the account decides whether that is allowed. Every account
          enforces a per-payment and a daily USDG cap, and caps the first payment to a recipient it has never
          paid (2 USDG on Sepolia) unless that recipient is allowlisted. Fees go only to the relayer set in
          the factory and never exceed 0.25 USDG, so whoever submits a transaction cannot pocket the fee.{" "}
          <code>restrict</code> applies a change at once only if it tightens the policy: freeze, lower caps,
          require the allowlist or the payment sheet, remove a recipient. Freezing also cancels every scheduled
          change. Anything that loosens the policy, including unfreezing, is scheduled and waits out the
          change delay; any owner, or the guardian, can cancel it. Scheduled changes are listed on-chain, so
          they show on every device.
        </p>
        <pre><code>{PROTECTIONS}</code></pre>
        <p>
          <b>Payment sheet.</b> With Secure Payment Confirmation (Chrome on macOS, Windows and Android), the
          browser, not the page, shows the payee and the total. The account accepts that client data only for
          <code>pay</code>, and only if its payee is the recipient in lowercase hex, its total is the amount plus
          the fee, and its rpId hashes to the account's. An owner can require the sheet
          (<code>changePayload.setPaymentSheet(true)</code>, instant); the account then refuses payments approved
          through the ordinary prompt. Elsewhere the app uses the ordinary passkey prompt.
        </p>
        <p>
          <b>Guardian.</b> The account stores <code>keccak256(abi.encode(typehash, account, guardian, salt))</code>.
          The salt comes from the passkey's PRF secret and differs per app, so the owner can always rebuild the
          guardian card and one guardian used by several apps links nothing. The guardian can freeze the
          account at once, veto scheduled changes, and start a recovery that waits out the recovery delay. It
          cannot veto a change to the guardian, which waits the change delay plus the recovery delay, so a
          guardian can delay the owners but never hold the account.
        </p>

        <h2>Linkable by consent</h2>
        <p>
          Accounts in different apps share nothing on-chain. When an auditor or an exchange needs to know that
          two accounts belong to one person, the owner approves a disclosure: a statement naming the chain,
          the factory, both apps and nullifiers, the audience, a nonce and an expiry. A second circuit
          (<code>circuits/link</code>) proves that one hidden passkey owns both nullifiers and signed that
          statement. Anyone can check it at <a href="/app/verify" style={{ color: "var(--vk-teal)" }}>/app/verify</a>;
          it cannot move funds, and whoever holds it can show it to others.
        </p>
        <pre><code>{DISCLOSURE}</code></pre>

        <h2>ERC-7579 validator</h2>
        <p>
          Accounts that are not VeraKey accounts can still use VeraKey proofs. <code>VeraKeyValidator</code> is an
          ERC-7579 validator module for Kernel and Nexus: a user operation is signed by proving a passkey
          assertion whose challenge is the userOpHash. ERC-1271 signatures are bound to the chain and the
          account, so they cannot be replayed to another account that installed the same nullifier. The module
          enforces no spending policy: pair it with a policy or hook module.
        </p>
        <pre><code>{VALIDATOR}</code></pre>

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
          scripts (strict CSP), open-source client, and on-chain caps, the new-recipient cap and timelocks that
          bound what any valid proof can spend. Not claimed: payment privacy or Sybil resistance. The full list
          of invariants, trust assumptions and accepted risks is in <code>SECURITY.md</code>.
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
            <tr><td>HonkVerifier.verify, called by the account</td><td className="vk-mono">712,554</td><td>nitro devnode, ArbOS 61 (bb 5.2.0 optimized ZK verifier; 3,781,398 with the default one)</td></tr>
            <tr><td>Account pay, first payment to a new recipient (proof + policy + 2 USDG transfers)</td><td className="vk-mono">1,043,768</td><td>nitro devnode, ArbOS 61 (≈ $0.06 on Arbitrum One at 0.02 gwei, ETH $2,668)</td></tr>
            <tr><td>Account pay, a recipient paid before</td><td className="vk-mono">988,934</td><td>nitro devnode, ArbOS 61</td></tr>
            <tr><td>Account restrict (e.g. lower the caps, freeze)</td><td className="vk-mono">979,007</td><td>nitro devnode, ArbOS 61</td></tr>
            <tr><td>Account logic alone (Stylus: parsing, nonce, policy, events; without the transfers)</td><td className="vk-mono">~126,000</td><td>from the call trace</td></tr>
            <tr><td>Factory createAccount (EIP-1167 clone + storage init)</td><td className="vk-mono">383,296</td><td>nitro devnode, ArbOS 61, programs cached; mostly first writes to storage</td></tr>
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
