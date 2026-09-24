#!/usr/bin/env bash
# Deploys VeraKey: the UltraHonk verifier (+ linked libraries), the Stylus account implementation
# and the Stylus factory, then writes deployments/<network>.json.
#
#   scripts/deploy.sh local            # nitro devnode on 127.0.0.1:8649 (scripts/devnode.sh up), test USDG
#   scripts/deploy.sh sepolia --check  # checks keys, origin, balances and toolchain; sends nothing
#   scripts/deploy.sh sepolia          # Arbitrum Sepolia, real Paxos USDG, keys from .env
#
# Required in .env for sepolia (see .env.example): DEPLOYER_PRIVATE_KEY, RELAYER_PRIVATE_KEY,
# VERAKEY_RP_ID, VERAKEY_ORIGIN.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
NETWORK=${1:?usage: scripts/deploy.sh local|sepolia [--check]}
MODE=${2:-deploy}
[[ "$MODE" == deploy || "$MODE" == --check ]] || { echo "unknown option: $MODE" >&2; exit 1; }
DEV_KEY=0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659 # public nitro devnode key
ARB_OWNER_PUBLIC=0x000000000000000000000000000000000000006b

[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" && set +a

case "$NETWORK" in
  local)
    RPC=${LOCAL_RPC:-http://127.0.0.1:8649}
    PUBLIC_RPC=$RPC
    CHAIN=412346
    KEY=$DEV_KEY
    RP_ID=${LOCAL_RP_ID:-localhost}
    ORIGIN=${LOCAL_ORIGIN:-http://localhost:5190}
    PER_TX_CAP=50000000      # 50 USDG
    DAILY_CAP=200000000      # 200 USDG
    NEW_PAYEE_CAP=5000000    # 5 USDG: largest first payment to an unknown recipient
    CHANGE_DELAY=10          # short so the end-to-end timelock tests finish quickly
    RECOVERY_DELAY=15
    ;;
  sepolia)
    RPC=${ARBITRUM_SEPOLIA_RPC:-https://sepolia-rollup.arbitrum.io/rpc}
    PUBLIC_RPC=https://sepolia-rollup.arbitrum.io/rpc # written to deployments/: never a keyed provider URL
    CHAIN=421614
    KEY=${DEPLOYER_PRIVATE_KEY:-}
    RELAYER_KEY=${RELAYER_PRIVATE_KEY:-}
    RP_ID=${VERAKEY_RP_ID:-}
    ORIGIN=${VERAKEY_ORIGIN:-}
    USDG=${USDG_ADDRESS:-0xFFC95faa3d63Cde504a05B567C600B78C0b41892}
    PER_TX_CAP=${VERAKEY_PER_TX_CAP:-10000000}   # 10 USDG (PRD demo default)
    DAILY_CAP=${VERAKEY_DAILY_CAP:-25000000}     # 25 USDG
    NEW_PAYEE_CAP=${VERAKEY_NEW_PAYEE_CAP:-2000000} # 2 USDG: largest first payment to an unknown recipient
    CHANGE_DELAY=${VERAKEY_CHANGE_DELAY:-120}      # demo value; production default is 86400
    RECOVERY_DELAY=${VERAKEY_RECOVERY_DELAY:-300}  # demo value; production default is 259200
    ;;
  *) echo "unknown network: $NETWORK" >&2; exit 1 ;;
esac

# Everything is checked before the first transaction, so a deployment never stops halfway (verifier
# deployed, factory not).
command -v cast >/dev/null && command -v forge >/dev/null || { echo "install Foundry (forge, cast) first" >&2; exit 1; }
PROBLEMS=0
ok() { echo "  ok    $*"; }
fail() { echo "  FAIL  $*"; PROBLEMS=$((PROBLEMS + 1)); }
warn() { echo "  warn  $*"; }
eth_at_least() { awk -v have="$(cast from-wei "$1")" -v need="$2" 'BEGIN { exit !(have + 0 >= need + 0) }'; }

echo "checks for $NETWORK:"
[[ "$(cargo stylus --version 2>/dev/null)" == *" 0.10.9" ]] && ok "cargo-stylus 0.10.9" \
  || fail "install cargo-stylus 0.10.9: cargo install --locked cargo-stylus --version 0.10.9"
[ -f "$ROOT/circuits/webauthn/target/vk_hash" ] && [ -f "$ROOT/circuits/link/target/vk_hash" ] \
  && ok "circuit verification keys (webauthn, link)" \
  || fail "no circuit verification keys: run scripts/build-circuit.sh"

CHAIN_ID=$(cast chain-id --rpc-url "$RPC" 2>/dev/null || echo none)
if [ "$CHAIN_ID" = "$CHAIN" ]; then
  ok "RPC answers as chain $CHAIN"
  FRAGMENTS=$(cast call $ARB_OWNER_PUBLIC 'getMaxStylusContractFragments()(uint16)' --rpc-url "$RPC" 2>/dev/null || echo 0)
  [[ "$FRAGMENTS" =~ ^[0-9]+$ ]] && [ "$FRAGMENTS" -ge 2 ] && ok "Stylus programs over 24 KB (up to $FRAGMENTS fragments)" \
    || fail "the chain cannot deploy Stylus programs over 24 KB (needs ArbOS 60+)"
elif [ "$NETWORK" = local ]; then
  fail "no devnode at $RPC: run scripts/devnode.sh up"
else
  fail "the RPC does not answer as chain $CHAIN (got: $CHAIN_ID)"
fi

# The factory binds every account to this origin and rpId for good. clientDataJSON carries the origin
# with no path and no trailing slash, and the rpId must be the origin's host or a parent domain of it,
# or the browser refuses to use the passkey.
if [ -z "$RP_ID" ] || [ -z "$ORIGIN" ]; then
  fail "set VERAKEY_ORIGIN (https://<the app's domain>) and VERAKEY_RP_ID (that domain) in .env"
elif [[ ! "$ORIGIN" =~ ^https?://[^/]+$ ]]; then
  fail "origin must be scheme://host[:port] with no path or trailing slash: $ORIGIN"
else
  ORIGIN_HOST=${ORIGIN#*://}
  ORIGIN_HOST=${ORIGIN_HOST%%:*}
  if [[ "$ORIGIN_HOST" != "$RP_ID" && "$ORIGIN_HOST" != *".$RP_ID" ]]; then
    fail "rpId $RP_ID must be $ORIGIN_HOST or a parent domain of it"
  elif [[ "$NETWORK" != local && "$ORIGIN" != https://* ]]; then
    fail "origin must use https on $NETWORK"
  else
    ok "accounts bind to origin $ORIGIN, rpId $RP_ID"
  fi
fi

DEPLOYER=""
if [ -z "$KEY" ]; then fail "set DEPLOYER_PRIVATE_KEY in .env"; else DEPLOYER=$(cast wallet address --private-key "$KEY"); fi
if [ "$NETWORK" != local ] && [ "$CHAIN_ID" = "$CHAIN" ]; then
  if [ -n "$DEPLOYER" ]; then
    BALANCE=$(cast balance "$DEPLOYER" --rpc-url "$RPC")
    eth_at_least "$BALANCE" 0.01 && ok "deployer $DEPLOYER holds $(cast from-wei "$BALANCE") ETH" \
      || fail "deployer $DEPLOYER holds $(cast from-wei "$BALANCE") ETH: fund it with at least 0.01 ETH"
  fi
  [ "$(cast call "$USDG" 'decimals()(uint8)' --rpc-url "$RPC" 2>/dev/null)" = 6 ] && ok "USDG at $USDG" \
    || fail "no 6-decimal token at USDG_ADDRESS $USDG"
  # The relayer is not needed to deploy, but the app needs it funded before anyone can pay.
  if [ -z "$RELAYER_KEY" ]; then
    fail "set RELAYER_PRIVATE_KEY in .env (the server signs every relayed transaction with it)"
  else
    RELAYER=$(cast wallet address --private-key "$RELAYER_KEY")
    RELAYER_ETH=$(cast balance "$RELAYER" --rpc-url "$RPC")
    RELAYER_USDG=$(cast call "$USDG" 'balanceOf(address)(uint256)' "$RELAYER" --rpc-url "$RPC" | cut -d' ' -f1)
    eth_at_least "$RELAYER_ETH" 0.003 && ok "relayer $RELAYER holds $(cast from-wei "$RELAYER_ETH") ETH" \
      || warn "relayer $RELAYER holds $(cast from-wei "$RELAYER_ETH") ETH; each relayed payment burns ~4.2M gas"
    awk -v units="$RELAYER_USDG" 'BEGIN { exit !(units + 0 >= 5000000) }' \
      && ok "relayer holds $(awk -v u="$RELAYER_USDG" 'BEGIN { printf "%.2f", u / 1e6 }') USDG for the demo faucet" \
      || warn "relayer holds $(awk -v u="$RELAYER_USDG" 'BEGIN { printf "%.2f", u / 1e6 }') USDG; the demo faucet sends 5 USDG to each new account (https://faucet.paxos.com)"
  fi
fi

if [ "$PROBLEMS" -gt 0 ]; then
  echo "$PROBLEMS problem(s); nothing was sent." >&2
  exit 1
fi
if [ "$MODE" = --check ]; then
  echo "ready: scripts/deploy.sh $NETWORK"
  exit 0
fi

KEY_FILE=$(mktemp)
chmod 600 "$KEY_FILE"
trap 'rm -f "$KEY_FILE"' EXIT
printf '%s' "$KEY" > "$KEY_FILE"

RP_ID_HASH=0x$(printf '%s' "$RP_ID" | sha256sum | cut -d' ' -f1)
ORIGIN_HEX=0x$(printf '%s' "$ORIGIN" | xxd -p | tr -d '\n')
echo "network=$NETWORK chainId=$CHAIN_ID deployer=$DEPLOYER rpId=$RP_ID origin=$ORIGIN"

forge_deploy() { # <script>:<contract> [forge script args...] -> address returned by run()
  local script=$1; shift
  (cd "$ROOT/contracts/evm" && forge script "$script" --rpc-url "$RPC" --private-key "$KEY" --broadcast --slow "$@" 2>&1) \
    | awk '/^== Return ==/{getline; print $NF}' | tail -1
}

stylus_deploy() { # <package> [constructor args...] -> deployed address
  local package=$1; shift
  local args=()
  [ $# -gt 0 ] && args=(--constructor-args "$@")
  # cargo-stylus bids exactly the current gas price, so the transaction is rejected as soon as the
  # base fee ticks up before inclusion. Bid twice that: Arbitrum charges the base fee, not the bid.
  local max_fee
  max_fee=$(cast gas-price --rpc-url "$RPC" | awk '{ printf "%.9f", 2 * $1 / 1e9 }')
  (cd "$ROOT/contracts/stylus" && cargo stylus deploy --contract "$package" --endpoint "$RPC" \
      --private-key-path "$KEY_FILE" --max-fee-per-gas-gwei "$max_fee" --no-verify "${args[@]}" 2>&1) \
    | sed 's/\x1b\[[0-9;]*m//g' | tee -a /dev/stderr | awk '/deployed code at address:/{print $NF}' | tail -1
}

echo "==> HonkVerifier"
VERIFIER=$(forge_deploy script/DeployVerifier.s.sol:DeployVerifier)
[ -n "$VERIFIER" ] || { echo "verifier deployment failed" >&2; exit 1; }
echo "    $VERIFIER"

echo "==> VeraKeyValidator (ERC-7579 module for Kernel / Nexus accounts)"
VALIDATOR=$(forge_deploy script/DeployValidator.s.sol:DeployValidator --sig "run(address,bytes32,string)" "$VERIFIER" "$RP_ID_HASH" "$ORIGIN")
[ -n "$VALIDATOR" ] || { echo "validator deployment failed" >&2; exit 1; }
echo "    $VALIDATOR"

echo "==> LinkHonkVerifier (consent-to-link disclosures)"
LINK_VERIFIER=$(forge_deploy script/DeployLinkVerifier.s.sol:DeployLinkVerifier)
[ -n "$LINK_VERIFIER" ] || { echo "link verifier deployment failed" >&2; exit 1; }
echo "    $LINK_VERIFIER"

if [ "$NETWORK" = local ]; then
  echo "==> TestUSDG (local only)"
  USDG=$(forge_deploy script/DeployTestUSDG.s.sol:DeployTestUSDG)
  echo "    $USDG"
fi

echo "==> VeraKeyAccount implementation (Stylus)"
IMPLEMENTATION=$(stylus_deploy verakey-account)
[ -n "$IMPLEMENTATION" ] || { echo "account deployment failed" >&2; exit 1; }
echo "    $IMPLEMENTATION"

echo "==> VeraKeyFactory (Stylus)"
FACTORY=$(stylus_deploy verakey-factory "$IMPLEMENTATION" "$VERIFIER" "$USDG" "$RP_ID_HASH" "$ORIGIN_HEX" \
  "$PER_TX_CAP" "$DAILY_CAP" "$NEW_PAYEE_CAP" "$CHANGE_DELAY" "$RECOVERY_DELAY")
[ -n "$FACTORY" ] || { echo "factory deployment failed" >&2; exit 1; }
echo "    $FACTORY"

FACTORY_ALT=""
if [ "$NETWORK" = local ]; then
  # A second factory whose only difference is the verifier: the front-running test proves it can
  # never produce the same account address as the real factory.
  echo "==> VeraKeyFactory with a different verifier (local test fixture)"
  FACTORY_ALT=$(stylus_deploy verakey-factory "$IMPLEMENTATION" "$USDG" "$USDG" "$RP_ID_HASH" "$ORIGIN_HEX" \
    "$PER_TX_CAP" "$DAILY_CAP" "$NEW_PAYEE_CAP" "$CHANGE_DELAY" "$RECOVERY_DELAY")
  echo "    $FACTORY_ALT"
fi

# Cached Stylus programs skip most of their per-call initialization cost (~60k gas off every
# createAccount, ~35k off every payment on the devnode). The devnode has no CacheManager, so the chain
# owner caches directly; on public chains the programs are bid into the CacheManager's cache.
cache_program() { # <address>
  if [ "$NETWORK" = local ]; then
    cast send 0x0000000000000000000000000000000000000072 "cacheProgram(address)" "$1" \
      --private-key "$KEY" --rpc-url "$RPC" >/dev/null && echo "    cached $1"
  else
    local bid max=${VERAKEY_CACHE_MAX_BID_WEI:-1000000000000000} # 0.001 ETH
    bid=$(cd "$ROOT/contracts/stylus" && cargo stylus cache suggest-bid "$1" --endpoint "$RPC" 2>/dev/null \
      | sed 's/\x1b\[[0-9;]*m//g' | grep -Eo '[0-9]+' | tail -1)
    if [ -z "$bid" ] || [ "$bid" -gt "$max" ]; then
      echo "    not cached $1 (suggested bid: ${bid:-unknown} wei; cap $max)"
      return 0
    fi
    (cd "$ROOT/contracts/stylus" && cargo stylus cache bid "$1" "$bid" --endpoint "$RPC" \
      --private-key-path "$KEY_FILE" >/dev/null 2>&1) && echo "    cached $1 (bid $bid wei)" || echo "    cache bid failed for $1"
  fi
}
echo "==> Stylus program cache"
cache_program "$IMPLEMENTATION"
cache_program "$FACTORY"

CONFIG_HASH=$(cast call "$FACTORY" 'configHash()(bytes32)' --rpc-url "$RPC")
VK_HASH=0x$(xxd -p "$ROOT/circuits/webauthn/target/vk_hash" | tr -d '\n')
LINK_VK_HASH=0x$(xxd -p "$ROOT/circuits/link/target/vk_hash" | tr -d '\n')
mkdir -p "$ROOT/deployments"
cat > "$ROOT/deployments/$NETWORK.json" <<JSON
{
  "network": "$NETWORK",
  "chainId": $CHAIN_ID,
  "rpcUrl": "$PUBLIC_RPC",
  "rpId": "$RP_ID",
  "origin": "$ORIGIN",
  "rpIdHash": "$RP_ID_HASH",
  "contracts": {
    "honkVerifier": "$VERIFIER",
    "linkVerifier": "$LINK_VERIFIER",
    "veraKeyValidator": "$VALIDATOR",
    "accountImplementation": "$IMPLEMENTATION",
    "factory": "$FACTORY",
    "factoryAlt": "$FACTORY_ALT",
    "usdg": "$USDG"
  },
  "policy": {
    "perTxCap": "$PER_TX_CAP",
    "dailyCap": "$DAILY_CAP",
    "newPayeeCap": "$NEW_PAYEE_CAP",
    "changeDelay": $CHANGE_DELAY,
    "recoveryDelay": $RECOVERY_DELAY
  },
  "configHash": "$CONFIG_HASH",
  "circuitVkHash": "$VK_HASH",
  "linkCircuitVkHash": "$LINK_VK_HASH",
  "deployer": "$DEPLOYER",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
echo "wrote deployments/$NETWORK.json"
