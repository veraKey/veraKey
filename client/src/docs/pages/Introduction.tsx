import { BookOpen, Code2, ShieldCheck, Wallet } from "lucide-react";
import { A, Callout, Card, Cards, H2 } from "../components";

export default function Introduction() {
  return (
    <>
      <H2>What VeraKey is</H2>
      <p>
        VeraKey is an account layer for passkey wallets on Arbitrum. You enroll one passkey, from iCloud Keychain or
        Google Password Manager, and each app built on VeraKey gives you a separate USDG smart account. Each approval, such as a
        payment, is proven in your browser with a zero-knowledge proof: the chain learns that your passkey approved
        exactly this action, but it never receives your passkey's public key or signature.
      </p>
      <p>
        So nothing on-chain ties your accounts in different apps together, unless you choose to prove the link to
        someone. VeraKey is to wallets what Hide My Email is to email addresses.
      </p>
      <H2>Who it is for</H2>
      <ul>
        <li><strong>People who pay with USDG</strong>, who want one Face ID or Touch ID for every app without one public history across all of them.</li>
        <li><strong>App developers</strong>, who want passkey accounts, gasless USDG payments and account protections without running a wallet.</li>
        <li><strong>Smart-account builders</strong>, who can bring the same proofs to ERC-7579 accounts through the VeraKey validator module.</li>
      </ul>
      <H2>What you can do</H2>
      <ul>
        <li>Create a passkey and get one account per app, derived before it is ever deployed.</li>
        <li>Pay in USDG with one passkey approval; a relayer pays the gas and takes a small USDG fee you approved.</li>
        <li>Protect the account: caps, a smaller cap on first payments to new recipients, an instant freeze, a private guardian and, in Chrome, the browser's own payment sheet.</li>
        <li>Prove to an auditor that two of your accounts share a passkey, without revealing the key.</li>
      </ul>
      <H2>Project status</H2>
      <Callout kind="warning" title="Testnet preview">
        VeraKey runs on Arbitrum Sepolia with Paxos USDG test tokens. The circuits and contracts have not had an
        independent audit. Do not use it with real funds. Read the <A href="/docs/security">security model</A> for what is
        guaranteed and what is not.
      </Callout>
      <H2>Where to go next</H2>
      <Cards>
        <Card href="/docs/guides/create-account" title="Use VeraKey" icon={Wallet}>Create an account, fund it and pay, step by step.</Card>
        <Card href="/docs/build/quickstart" title="Build with VeraKey" icon={Code2}>Developer preview: how apps add passkey accounts and gasless USDG payments.</Card>
        <Card href="/docs/architecture" title="Understand the architecture" icon={BookOpen}>Circuits, contracts and how a payment flows.</Card>
        <Card href="/docs/security" title="Review the security" icon={ShieldCheck}>Invariants, trust assumptions and known risks.</Card>
      </Cards>
    </>
  );
}
