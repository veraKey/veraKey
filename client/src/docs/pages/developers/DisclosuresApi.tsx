import { A, Code, H2, Table } from "../../components";

export default function DisclosuresApiPage() {
  return (
    <>
      <H2>Create a disclosure</H2>
      <Code lang="ts">{`
createDisclosure(
  request: { appIdA: bigint; appIdB: bigint; audience: string; nonce?: Hex; ttlSeconds?: number;
             labels?: { appA?: string; appB?: string } },
  emit?: (state: ProofState) => void,
): Promise<DisclosurePackage>
`}</Code>
      <p>
        It needs an unlocked session. The passkey approves a statement naming both accounts, the audience, a nonce and an
        expiry (<code>ttlSeconds</code>, 1 day by default), and the browser proves it with the link circuit. The link prover
        loads on first use and shares bb.js with the payment prover. Nothing is sent anywhere: you decide who gets the
        package.
      </p>
      <Code lang="ts">{`
const pkg = await vera.createDisclosure({
  appIdA: PAY_APP_ID,
  appIdB: SHOP_APP_ID,
  audience: "compliance@exchange.example",
  nonce: theirNonce,      // 32 bytes from the audience, if they sent one
  ttlSeconds: 86_400,
});
`}</Code>

      <H2>The package format</H2>
      <Code lang="ts" title="@verakey/sdk/disclosure">{`
interface LinkStatement {
  chainId: number;
  factory: Address;        // the factory whose accounts are linked
  appIdA: Hex;  nullifierA: Hex;
  appIdB: Hex;  nullifierB: Hex;
  audience: string;        // hashed into the challenge
  nonce: Hex;              // 32 bytes
  expiresAt: number;       // Unix seconds
}

interface DisclosurePackage {
  kind: "verakey-link-disclosure";
  version: 1;
  statement: LinkStatement;
  labels?: { appA?: string; appB?: string }; // display only
  origin: string;
  clientDataJSON: Hex;
  proof: Hex;
  publicInputs: Hex[];     // 8 field elements
}
`}</Code>
      <p>
        The passkey signs <code>linkDisclosureChallenge(statement)</code>: the keccak256 of the ABI-encoded typehash{" "}
        <code>VeraKeyLinkDisclosure(uint256 chainId,address factory,bytes32 appIdA,bytes32 nullifierA,bytes32 appIdB,bytes32
        nullifierB,bytes32 audience,bytes32 nonce,uint64 expiresAt)</code> and the fields, with the audience hashed.
      </p>

      <H2>Verify a disclosure</H2>
      <Code lang="ts">{`
import { verifyDisclosure } from "@verakey/sdk/disclosure";

const verdict = await verifyDisclosure(pkg, {
  publicClient, chainId, factory, rpIdHash, origin, // this deployment
  audience: "compliance@exchange.example",          // who is verifying: required
  nonce: theirNonce,                                // optional: the nonce you asked for
  linkVerifier,                                     // LinkHonkVerifier address, checked with eth_call
});
verdict.valid;    // true only if every check passed
verdict.checks;   // [{ name, ok, detail? }]
verdict.accounts; // { a, b }: address, deployed, ownedByNullifier
`}</Code>
      <Table
        head={["Option", "Meaning"]}
        rows={[
          [<code key="1">audience</code>, "Required. A disclosure made for anyone else fails, so a forwarded file is useless to its new holder."],
          [<code key="2">nonce</code>, "Optional. When given, the statement must carry it."],
          [<code key="3">maxTtlSeconds</code>, "Refuse disclosures valid for longer than this from now. Default MAX_DISCLOSURE_TTL_SECONDS (7 days)."],
          [<code key="4">linkVerifier / linkProver</code>, "How the proof is checked: on-chain with eth_call, locally with bb.js, or both. With neither, the proof check fails."],
          [<code key="5">now</code>, "Unix seconds to check the expiry against. Default: the current time."],
        ]}
      />

      <H2>The checks</H2>
      <p>In order, each reported by name in <code>verdict.checks</code>:</p>
      <ol>
        <li><strong>Format</strong> and <strong>Well-formed fields</strong>: a v1 link disclosure with valid field elements, a 32-byte nonce and 8 public inputs.</li>
        <li><strong>This deployment</strong>: the chain id and the factory match.</li>
        <li><strong>Two different apps</strong>.</li>
        <li><strong>Made for this audience</strong>, and <strong>Carries the nonce you asked for</strong> when a nonce was given.</li>
        <li><strong>Not expired</strong> and <strong>Short-lived</strong>.</li>
        <li><strong>Passkey signed this statement</strong>: the client data is a <code>webauthn.get</code> assertion over the statement's challenge.</li>
        <li><strong>Signed on the VeraKey origin</strong>, and not cross-origin.</li>
        <li><strong>Proof commits to this statement</strong>: the public inputs are recomputed from the client data, the rpId hash and the statement, never taken from the package.</li>
        <li><strong>Proof verifies on-chain</strong> and/or <strong>locally</strong>.</li>
        <li><strong>Accounts still owned by these nullifiers</strong>: both addresses come from the factory, and a deployed account still has its nullifier as an owner.</li>
      </ol>

      <H2>On-chain or local verification</H2>
      <p>
        On-chain verification calls <code>LinkHonkVerifier.verify(proof, publicInputs)</code> with <code>eth_call</code>:
        free, and no transaction. It trusts the RPC endpoint you use. For audiences that do not want to trust an RPC,
        verify locally with the link prover:
      </p>
      <Code lang="ts">{`
const linkProver = await vera.linkProver(); // or new LinkProver(prover.barretenberg)
const verdict = await verifyDisclosure(pkg, { ...options, linkProver });
`}</Code>
      <p>
        The verify page at <A href="/app/verify">/app/verify</A> does both. The link circuit is described in{" "}
        <A href="/docs/architecture/circuits#the-link-circuit">Circuits</A>.
      </p>
    </>
  );
}
