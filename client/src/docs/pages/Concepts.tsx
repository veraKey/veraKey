import { A, Code, H2 } from "../components";

export default function Concepts() {
  return (
    <>
      <H2>Passkeys and the PRF extension</H2>
      <p>
        A passkey is a WebAuthn credential: a P-256 key pair created by your passkey provider, such as iCloud Keychain
        or Google Password Manager. The private key stays with the provider and syncs, end-to-end encrypted, across your
        devices. Apps ask the passkey to sign, and your device checks Face ID, Touch ID or your PIN first.
      </p>
      <p>
        The PRF extension lets a passkey also return a 32-byte secret, derived from the credential and a fixed input.
        The same passkey always returns the same secret, on every device where it syncs. VeraKey uses it to derive your
        nullifiers, and refuses to create accounts with a passkey that does not support PRF.{" "}
        <A href="/docs/guides/create-account#what-you-need">Supported providers</A> lists which ones do.
      </p>

      <H2>Nullifiers</H2>
      <p>
        A nullifier is your owner id inside one app. It is a Poseidon2 hash of your passkey's public key, its PRF secret
        and the app's id, with a domain tag, computed over 128-bit limbs:
      </p>
      <Code lang="text" title="Nullifier">{`
nullifier = Poseidon2("VERAKEY_NULLIFIER_V1", publicKey.x, publicKey.y, prfSecret, appId)
`}</Code>
      <p>
        The same passkey gets the same nullifier in the same app on every device, and unrelated nullifiers in different
        apps. Without the PRF secret, nobody can compute your nullifiers, even with your public key. A nullifier is an
        owner id, not a proof that you are a unique person.
      </p>

      <H2>Per-app accounts</H2>
      <p>
        Every app gets its own smart account. Its address follows from the app id, your nullifier and the deployment's
        configuration, so the app knows it before the account exists:
      </p>
      <Code lang="text" title="Account address">{`
account = CREATE2(factory, salt = keccak256(appId, nullifier, configHash), EIP-1167 clone of the account implementation)
`}</Code>
      <p>
        The account is deployed the first time you use it, by the relayer. Because the configuration hash is part of
        the address, nobody can deploy your address first with a different verifier or policy.
      </p>

      <H2>Zero-knowledge proofs</H2>
      <p>
        Instead of sending your signature to the chain, your browser proves that it knows a valid passkey signature
        over the action, under a key that hashes to your nullifier. The proof also checks the relying party (VeraKey's
        rpId) and that your device verified you. The proof system is UltraHonk; the circuit is written in Noir and
        proven by bb.js in your browser in about 2 seconds.
      </p>
      <p>
        On-chain, a Solidity verifier generated from the same circuit checks the proof in 712,554 gas. See{" "}
        <A href="/docs/architecture/circuits">Circuits</A> and <A href="/docs/architecture/gas">Gas and performance</A>.
      </p>

      <H2>The relayer and fees</H2>
      <p>
        You never need ETH. A relayer simulates your action, submits it and pays the gas. The account pays the relayer a
        small USDG fee (0.02 USDG today) that is part of the action you approved, so the relayer cannot raise it.
      </p>
      <p>
        Each account refuses fees above its maximum (0.25 USDG on Arbitrum Sepolia) and pays fees only to the relayer
        address fixed when the account was created. Anyone else may submit your approved action; they just do not get
        the fee. The <A href="/docs/build/relayer-api">Relayer API</A> documents every endpoint.
      </p>

      <H2>Policy and timelocks</H2>
      <p>
        Authentication is not authorization. A valid proof shows that an owner approved; the account's policy decides
        whether the action may happen. Every account enforces per-payment and daily caps, a smaller cap on the first
        payment to a recipient it has never paid, an optional allowlist, and a freeze. It can also require the browser's
        payment sheet.
      </p>
      <p>
        Changes that tighten the policy, such as freezing or lowering a cap, apply at once. Changes that loosen it, such
        as raising a cap, adding an owner or unfreezing, are scheduled and wait out the change delay: 2 minutes on
        Arbitrum Sepolia, a demo value (the production default is 1 day). At most 8 scheduled changes wait at once, and
        they are listed on-chain, so you can see and cancel them from any device. See{" "}
        <A href="/docs/guides/protect">Protect your account</A>.
      </p>

      <H2>Guardians and recovery</H2>
      <p>
        You can add a backup passkey as a second owner, and name a guardian: a friend's wallet, a multisig or another
        account. The account stores only a salted hash of the guardian's address, so the guardian stays private until
        it acts.
      </p>
      <p>
        A guardian can freeze the account, veto scheduled changes and start a recovery, which replaces every owner after
        the recovery delay (5 minutes on Arbitrum Sepolia; the production default is 3 days). Any owner can cancel a
        recovery. The guardian cannot veto its own replacement. See <A href="/docs/guides/recovery">Recovery and
        guardians</A>.
      </p>

      <H2>Disclosures</H2>
      <p>
        Nothing on-chain links your accounts in different apps, but sometimes you want to prove that two accounts are
        yours, to an auditor or an exchange. A disclosure does that: your passkey approves a statement naming both
        accounts, the audience and an expiry, and a second circuit proves that one passkey owns both, without revealing
        it. See <A href="/docs/guides/disclosures">Prove two accounts are yours</A>.
      </p>
    </>
  );
}
