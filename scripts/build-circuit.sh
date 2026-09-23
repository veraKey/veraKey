#!/usr/bin/env bash
# Compiles the Noir circuit, runs its tests, writes the EVM verification key and the Solidity
# verifier, and copies the ACIR artifact into the SDK. Toolchain pins: see README.md.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"
cd "$ROOT/circuits/webauthn"
nargo test
nargo compile
bb write_vk -b target/verakey_webauthn.json -o target -t evm
bb write_solidity_verifier -k target/vk -o "$ROOT/contracts/evm/src/HonkVerifier.sol" -t evm
mkdir -p "$ROOT/packages/sdk/src/circuit"
# The artifact's file_map holds absolute source paths; keep them relative so the shipped copy is the
# same on every machine (and CI can check it is up to date).
node -e '
const fs = require("fs");
const artifact = JSON.parse(fs.readFileSync("target/verakey_webauthn.json", "utf8"));
for (const file of Object.values(artifact.file_map)) file.path = file.path.replace(/^.*\/(circuits\/|nargo\/)/, "$1");
fs.writeFileSync(process.argv[1], JSON.stringify(artifact));
' "$ROOT/packages/sdk/src/circuit/verakey_webauthn.json"
echo "circuit gates: $(bb gates -b target/verakey_webauthn.json | grep -o '"circuit_size": [0-9]*')"
