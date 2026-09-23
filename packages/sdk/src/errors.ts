/** The assertion does not satisfy the circuit (wrong key, PRF secret or authenticator data). */
export class ProofGenerationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ProofGenerationError";
  }
}
