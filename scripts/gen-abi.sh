#!/usr/bin/env bash
# Exports the Stylus contracts' Solidity interfaces, compiles them with forge and writes typed ABIs
# for the SDK, so the TypeScript side can never drift from the Rust contracts.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$ROOT/contracts/evm/src/interfaces"
(cd "$ROOT/contracts/stylus" \
  && cargo stylus export-abi --contract verakey-account --output "$ROOT/contracts/evm/src/interfaces/IVeraKeyAccount.sol" \
  && cargo stylus export-abi --contract verakey-factory --output "$ROOT/contracts/evm/src/interfaces/IVeraKeyFactory.sol")
(cd "$ROOT/contracts/evm" && forge build --silent)
node "$ROOT/scripts/write-abi.mjs"
