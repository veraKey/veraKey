#!/usr/bin/env bash
# Compiles the Noir circuits, runs their tests, writes the EVM verification keys and the Solidity
# verifiers, and copies the ACIR artifacts into the SDK. Toolchain pins: see README.md.
#   circuits/verakey_lib  shared assertion + nullifier logic
#   circuits/webauthn     authorizes one action (HonkVerifier.sol)
#   circuits/link         consent to link two apps (LinkHonkVerifier.sol)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"
mkdir -p "$ROOT/packages/sdk/src/circuit"

build() { # <circuit dir> <package name> <verifier file> <contract name> <interface name>
  local dir=$1 name=$2 file=$3 contract=$4 iface=$5
  cd "$ROOT/circuits/$dir"
  nargo test
  nargo compile
  bb write_vk -b "target/$name.json" -o target -t evm
  # --optimized: bb's gas-optimized ZK verifier (one contract, batched field inversions). The default
  # generator spends about half of verify() on hundreds of separate modexp inversions.
  bb write_solidity_verifier -k target/vk -o "$ROOT/contracts/evm/src/$file" -t evm --optimized
  if [ "$contract" != HonkVerifier ]; then
    sed -i -e "s/\binterface IVerifier\b/interface $iface/" -e "s/\bis IVerifier\b/is $iface/" \
      -e "s/\bcontract HonkVerifier\b/contract $contract/" "$ROOT/contracts/evm/src/$file"
  fi
  # The artifact's file_map holds absolute source paths; keep them relative so the shipped copy is the
  # same on every machine (and CI can check it is up to date).
  node -e '
  const fs = require("fs");
  const artifact = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  for (const file of Object.values(artifact.file_map)) file.path = file.path.replace(/^.*\/(circuits\/|nargo\/)/, "$1");
  fs.writeFileSync(process.argv[2], JSON.stringify(artifact));
  ' "target/$name.json" "$ROOT/packages/sdk/src/circuit/$name.json"
  echo "$dir gates: $(bb gates -b "target/$name.json" | grep -o '"circuit_size": [0-9]*')"
}

build webauthn verakey_webauthn HonkVerifier.sol HonkVerifier IVerifier
build link verakey_link LinkHonkVerifier.sol LinkHonkVerifier ILinkVerifier
