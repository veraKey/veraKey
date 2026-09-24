import { A, Callout, Code, H2, Table } from "../../components";

export default function CircuitsPage() {
  return (
    <>
      <H2>The authorization circuit</H2>
      <p>
        <code>circuits/webauthn</code> proves that a passkey approved one action, without revealing the passkey. Its private
        inputs are the P-256 public key, the signature, the 37-byte authenticator data and the PRF secret (two 128-bit
        limbs). It asserts:
      </p>
      <ol>
        <li>the authenticator data starts with the expected rpId hash;</li>
        <li>the flags have user presence (UP) and user verification (UV) set, and no attested data or extensions, so the data is exactly 37 bytes;</li>
        <li>the signature is a valid ES256 signature, under the hidden key, over <code>sha256(authenticatorData ‖ clientDataHash)</code>;</li>
        <li>the PRF limbs fit in 128 bits, and the nullifier is computed from the key, the PRF secret and the app id.</li>
      </ol>
      <p>
        The circuit has 56,528 UltraHonk gates (it fits 2^16). A proof is 8,768 bytes. The assertion checks live in{" "}
        <code>circuits/verakey_lib</code>, which both circuits share.
      </p>

      <H2>Public inputs</H2>
      <Table
        head={["#", "Input", "Where the account gets it"]}
        rows={[
          ["1–2", "clientDataHash (two 128-bit limbs)", "sha256 of the clientDataJSON it received and checked"],
          ["3–4", "rpIdHash (two 128-bit limbs)", "Stored at initialization"],
          ["5", "appId", "Stored at initialization"],
          ["6", "nullifier", "From the call; it must be one of the account's owners"],
        ]}
      />
      <p>
        The account computes every public input itself, so a proof only verifies for this client data (which contains
        the action hash as its challenge), this relying party, this app and an owner.
      </p>

      <H2>The nullifier</H2>
      <Code lang="text" title="circuits/verakey_lib: compute_nullifier">{`
nullifier = Poseidon2([NULLIFIER_DOMAIN, pk.x_hi, pk.x_lo, pk.y_hi, pk.y_lo, prf_hi, prf_lo, app_id])
NULLIFIER_DOMAIN = "VERAKEY_NULLIFIER_V1" (as a field element)
`}</Code>
      <p>
        The public key's coordinates and the PRF secret enter as 128-bit limbs. The SDK computes the same function in{" "}
        <code>@verakey/sdk/nullifier</code> (<code>computeNullifier</code>), so the app knows each account's owner and
        address before proving anything.
      </p>

      <H2>The link circuit</H2>
      <p>
        <code>circuits/link</code> proves a disclosure: one hidden passkey owns two nullifiers and signed the disclosure
        statement. It runs the same assertion check, then asserts that the two app ids differ and that both nullifiers
        derive from the same key and PRF secret. It has 8 public inputs: the client data hash and rpId hash (four limbs),
        then <code>appIdA</code>, <code>nullifierA</code>, <code>appIdB</code> and <code>nullifierB</code>.
      </p>
      <p>
        Its verifier, <code>LinkHonkVerifier</code>, has its own verification key, so a link proof can never authorize an
        account action. See <A href="/docs/build/disclosures">Disclosures</A>.
      </p>

      <H2>Toolchain and verifiers</H2>
      <Table
        head={["", "Authorization circuit", "Link circuit"]}
        rows={[
          ["Source", <code key="1">circuits/webauthn</code>, <code key="2">circuits/link</code>],
          ["Tests (nargo test)", "11", "7"],
          ["Verification key hash", <code key="3">0x16378935…caf37f12</code>, <code key="4">0x16256f66…80f21683</code>],
          ["Solidity verifier", "HonkVerifier", "LinkHonkVerifier"],
        ]}
      />
      <p>
        <code>scripts/build-circuit.sh</code> runs the tests, compiles with nargo 1.0.0-beta.25, writes each verification key
        with <code>bb write_vk -t evm</code>, and generates each verifier with{" "}
        <code>bb write_solidity_verifier -t evm --optimized</code> (Barretenberg 5.2.0). The optimized generator batches
        field inversions, which brings on-chain verification to 712,554 gas. CI rebuilds everything and fails if a
        committed verifier differs from the circuits.
      </p>
      <Callout kind="warning">
        The circuits have not had an independent audit, and UltraHonk itself has not been independently audited.
      </Callout>
    </>
  );
}
