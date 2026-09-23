import { UltraHonkBackend, type Barretenberg } from "@aztec/bb.js";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import type { Hex } from "viem";
import circuitArtifact from "./circuit/verakey_link.json";
import { bytesToHex, hexToBytes, limbs, sha256, toFieldHex } from "./bytes";
import { ProofGenerationError } from "./errors";
import { AUTHENTICATOR_DATA_LENGTH, UnsupportedAuthenticatorError, type PasskeyPublicKey } from "./webauthn";

/** Private and public inputs of the consent-to-link circuit (`circuits/link`). */
export interface LinkWitnessInput {
  publicKey: PasskeyPublicKey;
  /** r ‖ s, low-s. */
  signature: Uint8Array;
  authenticatorData: Uint8Array;
  prfSecret: Uint8Array;
  clientDataJSON: Uint8Array;
  rpIdHash: Uint8Array;
  appIdA: bigint;
  nullifierA: bigint;
  appIdB: bigint;
  nullifierB: bigint;
}

export interface LinkProof {
  proof: Hex;
  /** Eight public inputs: cdh_hi, cdh_lo, rp_hi, rp_lo, appIdA, nullifierA, appIdB, nullifierB. */
  publicInputs: Hex[];
  provingMs: number;
}

const circuit = circuitArtifact as unknown as CompiledCircuit;

/**
 * Proves that one passkey owns two per-app nullifiers and signed a fresh assertion (the disclosure
 * statement). Shares the Barretenberg instance of `VeraKeyProver`.
 */
export class LinkProver {
  private readonly noir = new Noir(circuit);
  private readonly backend: UltraHonkBackend;

  constructor(barretenberg: Barretenberg) {
    this.backend = new UltraHonkBackend(circuit.bytecode, barretenberg);
  }

  async prove(input: LinkWitnessInput): Promise<LinkProof> {
    if (input.authenticatorData.length !== AUTHENTICATOR_DATA_LENGTH) {
      throw new UnsupportedAuthenticatorError(
        `Expected ${AUTHENTICATOR_DATA_LENGTH} bytes of authenticator data, got ${input.authenticatorData.length}.`
      );
    }
    const start = performance.now();
    const [cdhHi, cdhLo] = limbs(await sha256(input.clientDataJSON));
    const [rpHi, rpLo] = limbs(input.rpIdHash);
    const [sHi, sLo] = limbs(input.prfSecret);
    let witness: Uint8Array;
    try {
      ({ witness } = await this.noir.execute({
        pub_key_x: Array.from(input.publicKey.x),
        pub_key_y: Array.from(input.publicKey.y),
        signature: Array.from(input.signature),
        authenticator_data: Array.from(input.authenticatorData),
        prf_secret_hi: toFieldHex(sHi),
        prf_secret_lo: toFieldHex(sLo),
        client_data_hash_hi: toFieldHex(cdhHi),
        client_data_hash_lo: toFieldHex(cdhLo),
        rp_id_hash_hi: toFieldHex(rpHi),
        rp_id_hash_lo: toFieldHex(rpLo),
        app_id_a: toFieldHex(input.appIdA),
        nullifier_a: toFieldHex(input.nullifierA),
        app_id_b: toFieldHex(input.appIdB),
        nullifier_b: toFieldHex(input.nullifierB),
      }));
    } catch (error) {
      throw new ProofGenerationError("The passkey assertion does not satisfy the consent-to-link circuit.", error);
    }
    const { proof, publicInputs } = await this.backend.generateProof(witness, { verifierTarget: "evm" });
    return { proof: bytesToHex(proof), publicInputs: publicInputs as Hex[], provingMs: Math.round(performance.now() - start) };
  }

  /** Verifies locally with the circuit's verification key (no chain access needed). */
  verify(proof: { proof: Hex; publicInputs: Hex[] }): Promise<boolean> {
    return this.backend.verifyProof({ proof: hexToBytes(proof.proof), publicInputs: proof.publicInputs }, { verifierTarget: "evm" });
  }
}
