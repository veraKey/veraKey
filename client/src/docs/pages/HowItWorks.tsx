import { A, Callout, Code, Flow, H2, H3, Table } from "../components";

export default function HowItWorks() {
  return (
    <>
      <H2>The journey of one payment</H2>
      <p>
        When you tap "Approve with passkey", five things happen. The first three run on your device; the last two on a
        relayer and on Arbitrum.
      </p>
      <Flow
        steps={[
          { title: "Action hash", detail: "The app hashes exactly what you approve." },
          { title: "Passkey", detail: "Face ID or Touch ID signs that hash." },
          { title: "Proof", detail: "Your browser proves the signature in zero knowledge." },
          { title: "Relayer", detail: "A relayer submits the proof and pays the gas." },
          { title: "Account", detail: "Your account checks everything, then pays." },
        ]}
      />

      <H2>Step by step</H2>
      <H3>1. The app builds the action hash</H3>
      <p>
        Everything you approve is hashed into one 32-byte challenge: the chain, your account, its nonce, the kind of
        action, the recipient, the amount, the relayer fee and a deadline. The deadline is at most 10 minutes away.
      </p>
      <Code lang="solidity" title="Action hash">{`
keccak256(abi.encode(typehash, chainId, account, nonce, kind, target, amount, dataHash, fee, deadline))
`}</Code>
      <p>
        Because the nonce and the chain are inside, a signature for one payment cannot be replayed, used on another
        chain or used for another account.
      </p>

      <H3>2. Your passkey signs it</H3>
      <p>
        The browser asks your passkey for a WebAuthn assertion over that challenge. Your device checks Face ID, Touch ID
        or your PIN first (user verification). VeraKey asks for no extensions when signing, so the authenticator data
        is always 37 bytes. In Chrome on macOS, Windows and Android, the browser's own{" "}
        <A href="/docs/guides/pay#confirm-in-the-payment-sheet">payment sheet</A> can ask instead, showing the payee and
        the total.
      </p>

      <H3>3. Your browser proves the signature</H3>
      <p>
        A Noir circuit, proven with UltraHonk by bb.js, checks the P-256 signature over the WebAuthn message, the flags
        and the relying party, and derives your nullifier. The public key, the signature and the PRF secret are private
        inputs: they stay in the browser. Proving takes about 2 seconds in desktop Chrome with 8 threads.
      </p>
      <p>
        The proof has six public inputs: the hash of the browser's client data (two limbs), the rpId hash (two limbs),
        the app id and the nullifier. <A href="/docs/architecture/circuits">Circuits</A> has the details.
      </p>

      <H3>4. The relayer submits</H3>
      <p>
        The app sends the proof and the call to a relayer, which checks that the account is a genuine VeraKey account,
        simulates the call, and only then submits it and pays the gas. In return the account pays a small USDG fee that
        was part of what you approved, capped by the account (0.25 USDG on Arbitrum Sepolia). The relayer cannot change
        what you signed, and anyone else may submit the same calldata instead.
      </p>

      <H3>5. The account checks and pays</H3>
      <p>Your account, a Rust program on Arbitrum Stylus, accepts the payment only if every check passes:</p>
      <ul>
        <li>the client data is a passkey assertion for this exact challenge, from the VeraKey origin;</li>
        <li>the proof verifies, through a Solidity UltraHonk verifier generated from the circuit;</li>
        <li>the nullifier is one of the account's owners;</li>
        <li>the payment fits the caps, the new-recipient cap, the allowlist, and the account is not frozen.</li>
      </ul>
      <p>
        It then consumes the nonce, sends the amount to the recipient and the fee to the relayer, all in USDG. A valid
        proof is not enough on its own: see <A href="/docs/guides/protect">Protect your account</A>.
      </p>

      <H2>What the chain sees</H2>
      <Table
        head={["Data", "On-chain?"]}
        rows={[
          ["The proof (8,768 bytes)", "Yes, in the transaction's calldata"],
          ["Your nullifier in this app", "Yes: it identifies the account's owner"],
          ["The browser's client data (type, challenge, origin)", "Yes"],
          ["Amount, recipient, fee and deadline", "Yes"],
          ["Your passkey's public key", "No"],
          ["The signature", "No"],
          ["The PRF secret", "No"],
        ]}
      />
      <p>
        The app also counts how many times your public key appears in each transaction it sends. The receipt shows the
        result: 0.
      </p>

      <H2>What never leaves your device</H2>
      <ul>
        <li>
          <strong>The passkey's private key</strong> stays with your passkey provider, which keeps it end-to-end
          encrypted across your devices.
        </li>
        <li>
          <strong>The PRF secret</strong> is held in the browser's memory for the session only. It is never stored,
          never sent to the relayer and never put on-chain.
        </li>
        <li>
          <strong>The public key and the signature</strong> are used only by the prover in your browser.
        </li>
      </ul>
      <Callout kind="security" title="What you trust">
        The VeraKey page code runs in your browser and can see these values while you use it. This is the main trust
        assumption; the <A href="/docs/security#trust-assumptions">security model</A> explains how the account limits
        what a compromised page could do.
      </Callout>
    </>
  );
}
