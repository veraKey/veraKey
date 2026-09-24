import type { ReactNode } from "react";
import { A, H2 } from "../../components";
import { slugify } from "../../slug";

const TERMS: [string, ReactNode][] = [
  ["Account", "A VeraKey smart account: an EIP-1167 clone of VeraKeyAccount on Arbitrum that holds USDG and enforces its policy. A passkey has one in every app."],
  ["Action hash", <>The 32-byte WebAuthn challenge for one action: keccak256 over the chain, account, nonce, kind, target, amount, data hash, fee and deadline. See <A href="/docs/reference/contracts#action-kinds">Action kinds</A>.</>],
  ["Allowlist", "An optional list of recipients. When it is on, the account pays only recipients on the list."],
  ["App", "An app id within one VeraKey deployment. Apps on the VeraKey origin share its rpId, so one passkey serves them all, yet each gets its own account. A site on another domain signs players in through the Sign in with VeraKey popup, with an app id derived from its origin."],
  ["appId", "A field element that names an app. The same passkey has a different account and nullifier in every app."],
  ["Authenticator data", "The 37 bytes a passkey returns with each assertion: the rpId hash, the flags and a counter. The signature covers them."],
  ["Barretenberg (bb, bb.js)", "Aztec's proving library. VeraKey proves with it in the browser and generates its Solidity verifiers with it."],
  ["Change delay", "How long a loosening change waits before anyone can apply it: 2 minutes on Arbitrum Sepolia, a demo value."],
  ["clientDataJSON", "The JSON a browser builds for an assertion: the type, the challenge (the action hash), the origin and more. The passkey signs its hash."],
  ["configHash", "The hash of the factory's configuration: implementation, verifier, token, rpId hash, origin, caps, delays, fee recipient and maxFee. It is part of every account's CREATE2 salt."],
  ["CRS", "The common reference string the prover needs. The app serves it from its own origin."],
  ["Daily cap", "The most an account can spend in one UTC day, fees included."],
  ["Disclosure", <>A package, made for one named audience, that proves one passkey owns two app accounts. Honest verifiers refuse it after it expires, but the link it reveals is permanent for anyone who holds the file. VeraKey calls this linkable by consent. See <A href="/docs/guides/disclosures">Prove two accounts are yours</A>.</>],
  ["EIP-1167", "The minimal proxy standard. Every VeraKey account is a 45-byte clone that delegates to the account implementation."],
  ["ERC-1271", "The standard for contracts that validate signatures. The VeraKey validator binds each such signature to one chain and one account."],
  ["ERC-7579", "The modular smart account standard. VeraKeyValidator brings VeraKey proofs to accounts such as Kernel and Nexus."],
  ["Fee recipient", "The one address every fee goes to (the relayer). It is fixed in the configuration."],
  ["Guardian", "An address the owner names to freeze the account, veto scheduled changes and recover it. The account stores only a salted commitment to it."],
  ["Guardian card", "What a guardian keeps to act for one account: the chain, the account, the guardian's address, the salt and the commitment."],
  ["maxFee", "The largest fee any action may carry: 0.25 USDG on Arbitrum Sepolia."],
  ["New-recipient cap", "The most a first payment can send to a recipient that was never paid and is not allowlisted: 2 USDG on Arbitrum Sepolia."],
  ["Nonce", "A counter that every authorization consumes, so each proof works once."],
  ["Nullifier", "An owner's id in one app: Poseidon2 of the passkey's public key, its PRF secret and the app id. It differs in every app and reveals neither the key nor the other apps."],
  ["Origin", "The web origin whose passkey assertions the accounts accept: https://verakey.mdloglabs.org."],
  ["Owner epoch", "A counter that owners are keyed by. A recovery increases it, which revokes every earlier owner at once."],
  ["Passkey", "A WebAuthn credential kept by iCloud Keychain or Google Password Manager and unlocked with Face ID, Touch ID or the device PIN."],
  ["Payment sheet", "The browser's Secure Payment Confirmation dialog. The browser itself shows the payee and total and signs them. An owner can require it for every payment."],
  ["Per-payment cap", "The most one payment can send, fee included."],
  ["Player ID", "The ID a site gets for a player through Sign in with VeraKey: the player's nullifier for the site's app id. It is the same on every visit, and different on every other site."],
  ["PRF", "The WebAuthn pseudo-random function extension. The passkey turns a fixed input into a secret only it can produce, which goes into every nullifier."],
  ["Proof", "An UltraHonk zero-knowledge proof that an owner's passkey approved an action. HonkVerifier checks it on-chain."],
  ["Public inputs", "What a proof is checked against: the client data hash, the rpId hash, the app id and the nullifier."],
  ["Recovery", "The guardian replaces every owner with a new nullifier. It waits the recovery delay, and any owner can cancel it before then."],
  ["Recovery delay", "How long a recovery waits: 5 minutes on Arbitrum Sepolia, a demo value."],
  ["Relayer", "The server that submits proof-authorized calls and pays their gas for a small USDG fee. It cannot move funds."],
  ["restrict", "The account function that applies a tightening change at once, such as a freeze or lower caps."],
  ["rpId", "The WebAuthn relying party id, verakey.mdloglabs.org. Every app uses VeraKey's, so one passkey serves them all."],
  ["rpIdHash", "sha256 of the rpId: the first 32 bytes of the authenticator data, and a public input of every proof."],
  ["Scheduled change", "A change that loosens the account. It applies only after the change delay, and owners or the guardian can cancel it."],
  ["Sign in with VeraKey", "A popup that lets a game or an app on its own domain sign players in with their VeraKey passkey and take USDG payments; the site's server verifies a proof itself."],
  ["Stylus", "Arbitrum's WebAssembly runtime. VeraKey's account and factory are Rust programs on it."],
  ["Timelock", "The wait before a scheduled change or a recovery can take effect."],
  ["UltraHonk", "The proof system VeraKey uses, from Barretenberg."],
  ["USDG", "Paxos Global Dollar, the stablecoin every VeraKey account holds and pays."],
  ["User verification (UV)", "The authenticator-data flag that says the passkey checked the user with a biometric or PIN. The circuit requires it, along with user presence (UP)."],
  ["Verifier", "A Solidity contract generated by bb that checks proofs: HonkVerifier for actions, LinkHonkVerifier for disclosures."],
];

export default function GlossaryPage() {
  return (
    <>
      <H2>Terms</H2>
      <dl className="dx-glossary">
        {TERMS.map(([term, definition]) => (
          <div key={term} id={slugify(term)}>
            <dt>{term}</dt>
            <dd>{definition}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
