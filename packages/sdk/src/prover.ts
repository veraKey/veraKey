import { Barretenberg, UltraHonkBackend, type BackendOptions } from "@aztec/bb.js";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import type { Hex } from "viem";
import circuitArtifact from "./circuit/verakey_webauthn.json";
import { bytesToHex, hexToBytes, limbs, sha256, toFieldHex } from "./bytes";
import { ProofGenerationError } from "./errors";

export { ProofGenerationError };
import { AUTHENTICATOR_DATA_LENGTH, UnsupportedAuthenticatorError, type PasskeyPublicKey } from "./webauthn";

/** Private and public inputs of the VeraKey WebAuthn circuit. */
export interface WitnessInput {
  publicKey: PasskeyPublicKey;
  /** r ‖ s, low-s. */
  signature: Uint8Array;
  authenticatorData: Uint8Array;
  prfSecret: Uint8Array;
  clientDataJSON: Uint8Array;
  rpIdHash: Uint8Array;
  appId: bigint;
  nullifier: bigint;
}

export interface VeraKeyProof {
  proof: Hex;
  /** The six public inputs in circuit order: cdh_hi, cdh_lo, rp_hi, rp_lo, appId, nullifier. */
  publicInputs: Hex[];
  provingMs: number;
}

const circuit = circuitArtifact as unknown as CompiledCircuit;

/** Generates UltraHonk proofs (EVM keccak transcript) for the deployed `HonkVerifier`. */
export class VeraKeyProver {
  private readonly noir = new Noir(circuit);
  private readonly backend: UltraHonkBackend;

  private constructor(readonly barretenberg: Barretenberg) {
    this.backend = new UltraHonkBackend(circuit.bytecode, barretenberg);
  }

  static async create(options: BackendOptions = {}): Promise<VeraKeyProver> {
    return new VeraKeyProver(await Barretenberg.new(options));
  }

  async prove(input: WitnessInput): Promise<VeraKeyProof> {
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
        app_id: toFieldHex(input.appId),
        nullifier: toFieldHex(input.nullifier),
      }));
    } catch (error) {
      throw new ProofGenerationError("The passkey assertion does not satisfy the VeraKey circuit.", error);
    }
    const { proof, publicInputs } = await this.backend.generateProof(witness, { verifierTarget: "evm" });
    return {
      proof: bytesToHex(proof),
      publicInputs: publicInputs as Hex[],
      provingMs: Math.round(performance.now() - start),
    };
  }

  async verify(proof: VeraKeyProof): Promise<boolean> {
    return this.backend.verifyProof(
      { proof: hexToBytes(proof.proof), publicInputs: proof.publicInputs },
      { verifierTarget: "evm" }
    );
  }

  async destroy(): Promise<void> {
    await this.barretenberg.destroy();
  }
}
