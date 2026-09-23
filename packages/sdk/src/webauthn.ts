import { p256 } from "@noble/curves/p256";
import { PRF_SALT_LABEL } from "./constants";
import { asBytes, concatBytes, sha256 } from "./bytes";

export interface PasskeyPublicKey {
  x: Uint8Array;
  y: Uint8Array;
}

/** A WebAuthn assertion reduced to what the circuit and the account need. */
export interface PasskeyAssertion {
  credentialId: Uint8Array;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  /** r ‖ s, normalized to low-s (the circuit rejects high-s signatures). */
  signature: Uint8Array;
  userHandle?: Uint8Array;
  /** First PRF output, present only on unlock assertions. */
  prfSecret?: Uint8Array;
}

export class PrfUnsupportedError extends Error {
  constructor() {
    super(
      "This passkey provider does not support the WebAuthn PRF extension, which VeraKey requires to keep your accounts unlinkable."
    );
    this.name = "PrfUnsupportedError";
  }
}

export class UnsupportedAuthenticatorError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnsupportedAuthenticatorError";
  }
}

/** Assertions that feed the circuit must carry exactly 37 bytes of authenticator data. */
export const AUTHENTICATOR_DATA_LENGTH = 37;

/** DER ECDSA signature → 64-byte r ‖ s with s ≤ n/2. */
export function derToLowS(der: Uint8Array): Uint8Array {
  return p256.Signature.fromDER(der).normalizeS().toCompactRawBytes();
}

/** Raw r ‖ s → low-s r ‖ s. */
export function normalizeLowS(signature: Uint8Array): Uint8Array {
  return p256.Signature.fromCompact(signature).normalizeS().toCompactRawBytes();
}

/** SubjectPublicKeyInfo (as returned by `getPublicKey()`) → affine P-256 coordinates. */
export function publicKeyFromSpki(spki: Uint8Array): PasskeyPublicKey {
  const point = spki.subarray(spki.length - 65);
  if (spki.length !== 91 || point[0] !== 0x04) {
    throw new UnsupportedAuthenticatorError("Only uncompressed P-256 (ES256) passkeys are supported.");
  }
  return { x: point.slice(1, 33), y: point.slice(33, 65) };
}

/** sha256(authenticatorData ‖ sha256(clientDataJSON)), the digest a passkey signs. */
export async function webauthnDigest(authenticatorData: Uint8Array, clientDataJSON: Uint8Array) {
  return sha256(concatBytes(authenticatorData, await sha256(clientDataJSON)));
}

export function verifyPasskeySignature(
  publicKey: PasskeyPublicKey,
  digest: Uint8Array,
  signature: Uint8Array
): boolean {
  const point = concatBytes(new Uint8Array([4]), publicKey.x, publicKey.y);
  return p256.verify(signature, digest, point, { prehash: false, lowS: false });
}

/** The (at most two) public keys that could have produced `signature` over `digest`. */
export function recoverPublicKeys(digest: Uint8Array, signature: Uint8Array): PasskeyPublicKey[] {
  const sig = p256.Signature.fromCompact(signature);
  const keys: PasskeyPublicKey[] = [];
  for (const bit of [0, 1]) {
    try {
      const raw = sig.addRecoveryBit(bit).recoverPublicKey(digest).toRawBytes(false);
      keys.push({ x: raw.slice(1, 33), y: raw.slice(33, 65) });
    } catch {
      // No point with this recovery bit.
    }
  }
  return keys;
}

/** The fixed PRF input VeraKey evaluates; the authenticator turns it into a per-credential secret. */
export async function prfSalt(): Promise<Uint8Array> {
  return sha256(new TextEncoder().encode(PRF_SALT_LABEL));
}

export function randomChallenge(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export interface CreatePasskeyOptions {
  rpId: string;
  rpName: string;
  userName: string;
  userDisplayName?: string;
  /**
   * Also enroll the passkey for Secure Payment Confirmation (Chromium): the browser then shows the
   * payee and total of each payment in its own sheet and signs them. Requires a platform authenticator.
   */
  payment?: boolean;
}

export interface RegisteredPasskey {
  credentialId: Uint8Array;
  publicKey: PasskeyPublicKey;
  /** Present when the authenticator evaluates PRF during registration (not guaranteed). */
  prfSecret?: Uint8Array;
  /** Enrolled for Secure Payment Confirmation in this browser profile. */
  payment: boolean;
}

/**
 * "available" when this browser can show Secure Payment Confirmation. Chromium ships it on macOS,
 * Windows and Android; Safari, Firefox, iOS and Linux do not.
 */
export async function spcAvailability(): Promise<string> {
  const api = (globalThis as { PaymentRequest?: { securePaymentConfirmationAvailability?: () => Promise<string> } }).PaymentRequest;
  if (!api?.securePaymentConfirmationAvailability) return "unavailable-no-api";
  try {
    return await api.securePaymentConfirmationAvailability();
  } catch {
    return "unavailable-error";
  }
}

/**
 * The SPC `total.value` for USDG base units (6 decimals), byte for byte what the account expects
 * (`verakey_core::client_data::format_total`): at least two decimals, trailing zeros trimmed.
 */
export function formatSpcTotal(units: bigint): string {
  let fraction = (units % 1_000_000n).toString().padStart(6, "0");
  while (fraction.length > 2 && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  return `${units / 1_000_000n}.${fraction}`;
}

/** Creates a discoverable ES256 passkey with PRF enabled (browser only). */
export async function createPasskey(options: CreatePasskeyOptions): Promise<RegisteredPasskey> {
  const salt = await prfSalt();
  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { id: options.rpId, name: options.rpName },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: options.userName,
        displayName: options.userDisplayName ?? options.userName,
      },
      challenge: randomChallenge(),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
        ...(options.payment ? { authenticatorAttachment: "platform" as const } : {}),
      },
      attestation: "none",
      extensions: {
        prf: { eval: { first: salt } },
        ...(options.payment ? { payment: { isPayment: true } } : {}),
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("Passkey creation was cancelled.");
  const response = credential.response as AuthenticatorAttestationResponse;
  if (response.getPublicKeyAlgorithm() !== -7) {
    throw new UnsupportedAuthenticatorError("The passkey provider did not create an ES256 key.");
  }
  const spki = response.getPublicKey();
  if (!spki) throw new UnsupportedAuthenticatorError("The browser did not expose the passkey public key.");
  const prf = (credential.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first?: BufferSource } } }).prf;
  if (!prf?.enabled && !prf?.results?.first) throw new PrfUnsupportedError();
  return {
    credentialId: new Uint8Array(credential.rawId),
    publicKey: publicKeyFromSpki(asBytes(spki)),
    prfSecret: prf.results?.first ? asBytes(prf.results.first as ArrayBuffer) : undefined,
    payment: !!options.payment,
  };
}

export interface GetAssertionOptions {
  rpId: string;
  challenge: Uint8Array;
  credentialIds?: Uint8Array[];
  /** Unlock assertions evaluate PRF; signing assertions must not (keeps authData at 37 bytes). */
  withPrf?: boolean;
}

/** Requests a user-verified assertion (browser only). */
export async function getAssertion(options: GetAssertionOptions): Promise<PasskeyAssertion> {
  const extensions = options.withPrf
    ? ({ prf: { eval: { first: await prfSalt() } } } as AuthenticationExtensionsClientInputs)
    : undefined;
  const credential = (await navigator.credentials.get({
    publicKey: {
      rpId: options.rpId,
      challenge: options.challenge,
      userVerification: "required",
      allowCredentials: options.credentialIds?.map(id => ({ type: "public-key" as const, id })),
      extensions,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("Passkey authentication was cancelled.");
  const response = credential.response as AuthenticatorAssertionResponse;
  const prf = (credential.getClientExtensionResults() as { prf?: { results?: { first?: BufferSource } } }).prf;
  if (options.withPrf && !prf?.results?.first) throw new PrfUnsupportedError();
  return {
    credentialId: new Uint8Array(credential.rawId),
    authenticatorData: asBytes(response.authenticatorData),
    clientDataJSON: asBytes(response.clientDataJSON),
    signature: derToLowS(asBytes(response.signature)),
    userHandle: response.userHandle ? asBytes(response.userHandle) : undefined,
    prfSecret: prf?.results?.first ? asBytes(prf.results.first as ArrayBuffer) : undefined,
  };
}

export interface SpcAssertionOptions {
  rpId: string;
  challenge: Uint8Array;
  credentialIds: Uint8Array[];
  /** The recipient, as `0x` + 40 lowercase hex digits (the account compares it byte for byte). */
  payee: string;
  /** USDG base units that leave the account (amount plus relayer fee). */
  total: bigint;
  instrument: { displayName: string; icon: string };
}

/**
 * Asks the browser to confirm a payment in its own Secure Payment Confirmation sheet, which shows the
 * payee and total and signs them into the client data (`"type":"payment.get"`).
 */
export async function getSpcAssertion(options: SpcAssertionOptions): Promise<PasskeyAssertion> {
  const request = new PaymentRequest(
    [
      {
        supportedMethods: "secure-payment-confirmation",
        data: {
          credentialIds: options.credentialIds,
          challenge: options.challenge,
          rpId: options.rpId,
          payeeName: options.payee,
          instrument: { ...options.instrument, iconMustBeShown: false },
          timeout: 120_000,
        },
      },
    ] as never,
    { total: { label: "Total", amount: { currency: "USD", value: formatSpcTotal(options.total) } } }
  );
  const response = await request.show();
  await response.complete("success");
  const credential = response.details as PublicKeyCredential;
  const assertion = credential.response as AuthenticatorAssertionResponse;
  return {
    credentialId: new Uint8Array(credential.rawId),
    authenticatorData: asBytes(assertion.authenticatorData),
    clientDataJSON: asBytes(assertion.clientDataJSON),
    signature: derToLowS(asBytes(assertion.signature)),
    userHandle: assertion.userHandle ? asBytes(assertion.userHandle) : undefined,
  };
}
