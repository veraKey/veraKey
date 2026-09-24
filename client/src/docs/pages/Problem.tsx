import { A, Callout, H2, Table } from "../components";

export default function Problem() {
  return (
    <>
      <H2>One passkey, one global identity</H2>
      <p>
        Passkeys fixed the worst part of self-custody: there is no seed phrase to write down, and signing is a Face ID
        or Touch ID prompt. But most passkey wallets turn that one passkey into one global identity. Either you get one
        address in every app, or several accounts that are tied together on-chain by the same key.
      </p>
      <p>
        Anyone reading the chain can then join your activity across apps. The shop you pay can see your savings
        balance, your tips and your salary. An analytics company only has to connect one of your accounts to you to
        see all of them.
      </p>

      <H2>The public key is on-chain</H2>
      <p>
        A passkey smart account has to know which key it trusts, so it keeps the passkey's public key: in storage, in
        an event, or in the calldata of every signature check. All eight passkey smart accounts we inspected while
        designing VeraKey store the public key or emit it in an event.
      </p>
      <p>
        A public key that appears in several accounts is a join key. Even if each app deploys a fresh account for you,
        the same 64-byte key shows up in all of them.
      </p>

      <H2>Why one passkey per app is not enough</H2>
      <p>
        You could create a separate passkey for every app. That avoids the shared key, but it costs an enrollment in
        every app, a credential picker every time you sign, and a separate recovery setup per account. It also moves
        the burden back to the user, which is what passkeys were meant to remove.
      </p>

      <H2>What VeraKey changes</H2>
      <p>You enroll once. VeraKey then separates your apps without asking you to manage anything:</p>
      <ul>
        <li>
          <strong>One account per app.</strong> Each account is owned by a <em>nullifier</em>, a hash of your passkey's
          public key, a PRF secret that only your passkey can produce, and the app's id. Different apps get unrelated
          nullifiers.
        </li>
        <li>
          <strong>A proof instead of a signature.</strong> Your browser proves in zero knowledge that your passkey
          approved the exact action. The chain receives the proof and the nullifier, never the public key or the
          signature.
        </li>
        <li>
          <strong>No shortcut through a leaked key.</strong> Without the PRF secret, even someone who learns your public
          key cannot compute your nullifiers, so they cannot find your accounts.
        </li>
      </ul>
      <p>
        See <A href="/docs/how-it-works">How VeraKey works</A> for the journey of one payment, and{" "}
        <A href="/docs/concepts">Key concepts</A> for the terms.
      </p>

      <H2>Unlinkable, not anonymous</H2>
      <p>
        VeraKey removes the key material that links your accounts. It does not hide what each account does. The table
        below is the honest version.
      </p>
      <Table
        head={["Stays public", "Why"]}
        rows={[
          ["Each account's address, amounts, recipients and timing", "Payments are ordinary USDG transfers on Arbitrum."],
          ["Links created by funding", "Topping up several accounts from one wallet connects them on-chain. Fund each account separately."],
          ["The issuer's control", "Paxos, USDG's issuer, can freeze any single account, as with any regulated stablecoin."],
        ]}
      />
      <Callout kind="note" title="Not claimed">
        VeraKey does not claim payment privacy or Sybil resistance. It keeps your apps from being linked through your
        key; for the full list of what leaks and what is assumed, read the <A href="/docs/security">security model</A>.
      </Callout>
    </>
  );
}
