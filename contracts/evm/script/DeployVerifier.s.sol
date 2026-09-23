// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {HonkVerifier} from "../src/HonkVerifier.sol";

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Deploys the bb-generated (optimized, ZK) UltraHonk verifier.
contract DeployVerifier {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address verifier) {
        vm.startBroadcast();
        verifier = address(new HonkVerifier());
        vm.stopBroadcast();
    }
}
