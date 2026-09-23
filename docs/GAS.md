# Gas analysis

Measured 2026-09-23 on a local nitro devnode (nitro-node v3.11.4, ArbOS 61, L1 price set to 0) with
`debug_traceTransaction` (call tracer) on a real `pay` transaction: a browser-generated UltraHonk proof
of a WebAuthn P-256 assertion, submitted through the relayer.

## Where one `pay` spends its gas

| Frame | Gas | Notes |
|---|---:|---|
| Transaction total | 4,171,302 | 9,604 bytes of calldata |
| ├─ intrinsic + calldata + EIP-1167 proxy | ~172,500 | 21,000 + 16 gas per non-zero byte |
| └─ `VeraKeyAccount.pay` (Stylus, via DELEGATECALL) | 3,998,779 | |
| &nbsp;&nbsp;&nbsp;├─ SHA-256 of `clientDataJSON` (precompile `0x02`) | 120 | 134 bytes |
| &nbsp;&nbsp;&nbsp;├─ `HonkVerifier.verify` (Solidity, bb-generated) | 3,781,398 | see below |
| &nbsp;&nbsp;&nbsp;└─ account logic: JSON/base64url checks, nonce, policy, 2 × USDG `transfer`, events | ~217,000 | |

The Stylus account itself costs about 217k gas including two token transfers. The proof verification
dominates.

## Inside `HonkVerifier.verify` (3,781,398 gas on ArbOS 61)

| Call | Count | Gas |
|---|---:|---:|
| `modexp` precompile (`0x05`), 32-byte operands: field inversions | 466 | 1,882,820 |
| `ecMul` (`0x07`) | 59 | 354,000 |
| `RelationsLib` (DELEGATECALL) | 1 | 203,853 |
| `ecPairing` (`0x08`), 2 pairs | 1 | 113,000 |
| `ZKTranscriptLib` (DELEGATECALL) | 1 | 81,858 |
| `ecAdd` (`0x06`) | 59 | 8,850 |
| EVM field arithmetic, keccak transcript, memory | — | ~1,137,000 |

The same `verify` measured 2,526,063 gas in Foundry's EVM (Cancun pricing). The difference comes mostly
from `modexp` pricing on ArbOS 61 (~4,040 gas per 32-byte inversion).

## What this means

- Half of the verification cost is 466 independent field inversions. Batch inversion (Montgomery's
  trick: one inversion plus three multiplications per element) would remove most of them.
- Field arithmetic and batch inversion are natural to write in Rust. A Stylus UltraHonk verifier that
  keeps the elliptic-curve precompiles (`ecMul`, `ecAdd`, `ecPairing`: ~476k gas) and does the field work
  in WASM is the clearest way to cut the cost of private authorization on Arbitrum. The account already
  calls the verifier through a one-function interface (`verify(bytes, bytes32[]) returns (bool)`), so a
  Stylus verifier would be a drop-in replacement through a new factory configuration.
- Baseline for comparison: a non-private passkey signature check through `P256VERIFY` costs 3,450 gas.
