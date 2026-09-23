#!/usr/bin/env bash
# Local Arbitrum chain for VeraKey: a nitro dev node on 127.0.0.1:8649, upgraded to ArbOS 61 so the
# multi-fragment Stylus programs (the account implementation is ~40 KB compressed) can be deployed.
#
#   scripts/devnode.sh up       # start (no-op if already running) and wait until it is ready
#   scripts/devnode.sh down     # stop and remove the container; the chain state is discarded
#   scripts/devnode.sh status   # chain id, ArbOS version, latest block
#
# The chain is ephemeral: after `down` or a reboot, run `up` and then `scripts/deploy.sh local`.
# Chain setup follows OffchainLabs/nitro-devnode run-dev-node.sh (Apache-2.0, commit ebb523d): chain
# owner, zero L1 price, the CREATE2 factory, and the StylusDeployer that cargo-stylus deploys through.
# scripts/devnode/*.hex are copied from that repository; see scripts/devnode/LICENSE.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DATA="$ROOT/scripts/devnode"
IMAGE=${NITRO_IMAGE:-offchainlabs/nitro-node:v3.11.4-7d5ac27}
CONTAINER=${DEVNODE_CONTAINER:-verakey-nitro-dev}
PORT=${DEVNODE_PORT:-8649}
RPC=http://127.0.0.1:$PORT
ARBOS=61
KEY=0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659 # public nitro devnode key
CREATE2_FACTORY=0x4e59b44847b379578588920ca78fbf26c0b4956c
CREATE2_SIGNER=0x3fab184622dc19b6109349b94811493bf2a45362
STYLUS_DEPLOYER=0xcEcba2F1DC234f70Dd89F2041029807F8D03A990
SALT=0x0000000000000000000000000000000000000000000000000000000000000000
ARB_SYS=0x0000000000000000000000000000000000000064
ARB_OWNER=0x0000000000000000000000000000000000000070
ARB_OWNER_PUBLIC=0x000000000000000000000000000000000000006b
ARB_DEBUG=0x00000000000000000000000000000000000000ff

rpc_ready() {
  curl -s -m 2 -X POST -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","method":"net_version","params":[],"id":1}' "$RPC" 2>/dev/null | grep -q result
}

arbos_version() { echo $(( $(cast call $ARB_SYS 'arbOSVersion()(uint256)' --rpc-url "$RPC") - 55 )); }

has_code() { [ "$(cast code "$1" --rpc-url "$RPC")" != "0x" ]; }

send() { cast send --rpc-url "$RPC" --private-key "$KEY" "$@" >/dev/null; }

ready() { rpc_ready && [ "$(arbos_version)" = "$ARBOS" ] && has_code $STYLUS_DEPLOYER; }

status() {
  if ! rpc_ready; then echo "devnode: not running ($RPC)"; return 1; fi
  echo "devnode: $RPC chainId=$(cast chain-id --rpc-url "$RPC") ArbOS=$(arbos_version)" \
    "maxFragments=$(cast call $ARB_OWNER_PUBLIC 'getMaxStylusContractFragments()(uint16)' --rpc-url "$RPC")" \
    "block=$(cast block-number --rpc-url "$RPC")"
}

up() {
  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" && ready; then
    status
    return
  fi
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

  echo "starting $IMAGE as $CONTAINER on $RPC"
  docker run -d --rm --name "$CONTAINER" -p "127.0.0.1:$PORT:8547" "$IMAGE" \
    --dev --http.addr 0.0.0.0 --http.api=net,web3,eth,debug >/dev/null
  for _ in $(seq 1 600); do rpc_ready && break; sleep 0.2; done
  rpc_ready || { echo "the node did not answer on $RPC; see: docker logs $CONTAINER" >&2; exit 1; }

  echo "chain owner, zero L1 price"
  send $ARB_DEBUG 'becomeChainOwner()'
  send $ARB_OWNER 'setL1PricePerUnit(uint256)' 0

  echo "CREATE2 factory"
  send --value 1ether $CREATE2_SIGNER
  cast publish --rpc-url "$RPC" "$(cat "$DATA/create2-factory-tx.hex")" >/dev/null
  has_code $CREATE2_FACTORY || { echo "CREATE2 factory deployment failed" >&2; exit 1; }

  echo "StylusDeployer"
  send $CREATE2_FACTORY "$SALT$(cat "$DATA/stylus-deployer.hex")"
  has_code $STYLUS_DEPLOYER || { echo "StylusDeployer deployment failed" >&2; exit 1; }

  echo "ArbOS $(arbos_version) -> $ARBOS"
  send $ARB_OWNER 'scheduleArbOSUpgrade(uint64,uint64)' $ARBOS 0
  for _ in $(seq 1 10); do
    [ "$(arbos_version)" = "$ARBOS" ] && break
    send --value 0 0x0000000000000000000000000000000000000000 # a block applies the scheduled upgrade
  done
  [ "$(arbos_version)" = "$ARBOS" ] || { echo "ArbOS upgrade failed" >&2; exit 1; }

  status
}

case "${1:-up}" in
  up) up ;;
  down) docker rm -f "$CONTAINER" >/dev/null 2>&1 && echo "stopped $CONTAINER" || echo "$CONTAINER is not running" ;;
  status) status ;;
  *) echo "usage: scripts/devnode.sh up|down|status" >&2; exit 1 ;;
esac
