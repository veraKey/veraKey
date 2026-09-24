import { A, Callout, H2, Step, Steps, Table } from "../../components";

export default function DisclosuresGuide() {
  return (
    <>
      <H2>When to use a disclosure</H2>
      <p>
        Your accounts in different apps share nothing on-chain. Sometimes you need someone to know that two of them are
        yours: an auditor checking your records, an exchange confirming where funds came from, or a lender. A disclosure
        proves it to them without revealing your passkey and without putting anything on-chain. Whoever holds the file
        can show it to anyone, for good, so share one only with someone you trust with that fact.
      </p>

      <H2>Make a disclosure</H2>
      <Steps>
        <Step title="Open Disclose">
          <p>Select <strong>Disclose</strong> in the app. The statement covers your Pay and Shop accounts.</p>
        </Step>
        <Step title="Name the audience">
          <p>
            Under <strong>For whom (audience)</strong>, enter the identifier the other party gave you, for example{" "}
            <code>compliance@exchange.example</code>. They will enter the same value when they verify, and a disclosure
            made for someone else fails for them.
          </p>
        </Step>
        <Step title="Add their nonce, if they gave you one">
          <p>
            If they sent you a 32-byte hex nonce, paste it under <strong>Their request nonce</strong>. It proves the
            disclosure was made in answer to their request. Otherwise a random nonce is used.
          </p>
        </Step>
        <Step title="Choose how long it is valid">
          <p>1 hour, 1 day or 7 days. After that, an honest verifier refuses it; what it revealed stays known.</p>
        </Step>
        <Step title="Approve disclosure with passkey">
          <p>
            Your passkey approves the statement, and your browser proves, with a second circuit, that one passkey owns
            both accounts. Nothing is sent anywhere.
          </p>
        </Step>
      </Steps>

      <H2>Share it</H2>
      <p>
        When the proof is ready, select <strong>Download</strong> for a JSON file, or <strong>Copy</strong>. Send it to the
        audience however you like. <strong>Verify it as the audience would</strong> opens the verify page with your
        disclosure, so you can check it first.
      </p>

      <H2>Verify a disclosure</H2>
      <p>
        The audience opens <A href="/app/verify">/app/verify</A>. It needs no passkey and no account. They paste the JSON
        or select <strong>Open file</strong>, type their audience identifier exactly as they gave it to you, add the nonce
        they asked for (optional) and select <strong>Verify</strong>. The page runs every check and shows each result:
      </p>
      <Table
        head={["Check", "It passes when"]}
        rows={[
          ["Format and well-formed fields", "The file is a VeraKey link disclosure with valid values."],
          ["This deployment", "The statement names this chain and this factory."],
          ["Two different apps", "The two accounts are in different apps."],
          ["Made for this audience", "The statement names exactly the audience the verifier typed."],
          ["Carries the nonce you asked for", "Only when the verifier entered a nonce: it matches."],
          ["Not expired, short-lived", "The expiry is in the future and no more than 7 days away."],
          ["Passkey signed this statement", "The signed client data is a passkey assertion over this statement."],
          ["Signed on the VeraKey origin", "The assertion was made on the VeraKey site."],
          ["Proof commits to this statement", "The proof's public inputs are this statement's."],
          ["Proof verifies on-chain and locally", "The link verifier on Arbitrum (by eth_call) and bb.js in the browser both accept the proof."],
          ["Accounts still owned by these nullifiers", "Each account derives from the factory, and a deployed account is still owned by its nullifier."],
        ]}
      />

      <H2>What a disclosure reveals</H2>
      <ul>
        <li>That the two accounts in the statement have the same owner. Not your passkey, not your name.</li>
        <li>It cannot move funds.</li>
        <li>
          The link it reveals is permanent. The expiry, the audience and the nonce protect verifiers from replays, not your
          privacy: anyone who obtains the file learns that the two accounts share an owner and can check the proof. Only an
          honest verifier checking under its own name sees a forwarded disclosure fail.
        </li>
      </ul>
      <Callout kind="note">
        Developers can create and verify disclosures with the SDK: see <A href="/docs/build/disclosures">Disclosures</A>.
      </Callout>
    </>
  );
}
